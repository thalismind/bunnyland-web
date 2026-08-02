import { sendAdmin, serverFromUrl } from '@bunnyland/ui-web/api';
import { AuthGate, AuthProvider, Button, EmptyState, StatusText } from '@bunnyland/ui-web/preact';
import { render } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';

import { confirmDialog } from '../dialogs';

type IdentityKind = 'client' | 'discord' | 'web';
type RestrictionKind = 'banned' | 'suspended';
type ModerationAction = 'ban' | 'kick' | 'lift' | 'suspend';
type DurationUnit = 'days' | 'hours' | 'minutes' | 'seconds' | 'weeks';

export interface ModerationIdentity {
  id: string;
  kind: IdentityKind;
}

interface ModerationRestriction {
  created_at: string;
  expires_at: string | null;
  kind: RestrictionKind;
  reason: string;
}

interface ModerationClaim {
  character_id: string;
  character_name: string;
  claim_id: string;
}

export interface ModerationPlayer {
  admin: boolean;
  claims: ModerationClaim[];
  identity: ModerationIdentity;
  restriction: ModerationRestriction | null;
}

interface ModerationAuditEntry {
  action: ModerationAction;
  administrator: ModerationIdentity;
  created_at: string;
  expires_at: string | null;
  id: string;
  reason: string;
  target: ModerationIdentity;
}

interface PlayerResponse { players: ModerationPlayer[] }
interface AuditResponse { actions: ModerationAuditEntry[] }

const UNIT_SECONDS: Record<DurationUnit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3_600,
  days: 86_400,
  weeks: 604_800,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function parsePlayers(value: unknown): ModerationPlayer[] {
  if (!isObject(value) || !Array.isArray(value.players)) throw new Error('Invalid player response');
  return (value as unknown as PlayerResponse).players;
}

function parseActions(value: unknown): ModerationAuditEntry[] {
  if (!isObject(value) || !Array.isArray(value.actions)) throw new Error('Invalid audit response');
  return (value as unknown as AuditResponse).actions;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function canonicalIdentity(identity: ModerationIdentity): string {
  return `${identity.kind}:${identity.id}`;
}

export function durationToSeconds(value: number, unit: DurationUnit): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Suspension duration must be a positive whole number');
  }
  const seconds = value * UNIT_SECONDS[unit];
  if (!Number.isSafeInteger(seconds)) throw new Error('Suspension duration is too large');
  return seconds;
}

function sameIdentity(left: ModerationIdentity | null, right: ModerationIdentity): boolean {
  return left?.kind === right.kind && left.id === right.id;
}

export interface ModerationPageProps {
  base?: string;
  confirmAction?: (message: string) => Promise<boolean>;
  request?: typeof sendAdmin;
}

export function ModerationPage({
  base = serverFromUrl() || '/api/v1',
  confirmAction = message => confirmDialog(message, {
    confirmLabel: 'Apply moderation',
    title: 'Confirm moderation action',
    tone: 'danger',
  }),
  request = sendAdmin,
}: ModerationPageProps) {
  const [players, setPlayers] = useState<ModerationPlayer[]>([]);
  const [history, setHistory] = useState<ModerationAuditEntry[]>([]);
  const [selected, setSelected] = useState<ModerationIdentity | null>(null);
  const [search, setSearch] = useState('');
  const [manualKind, setManualKind] = useState<IdentityKind>('discord');
  const [manualId, setManualId] = useState('');
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState(30);
  const [durationUnit, setDurationUnit] = useState<DurationUnit>('minutes');
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('Loading players…');
  const [error, setError] = useState('');

  const selectedPlayer = players.find(player => sameIdentity(selected, player.identity)) || null;

  const loadHistory = useCallback(async (target: ModerationIdentity | null): Promise<void> => {
    if (!target) { setHistory([]); return; }
    const query = new URLSearchParams({ target_kind: target.kind, target_id: target.id });
    setHistory(parseActions(await request(base, `/admin/moderation/actions?${query}`)));
  }, [base, request]);

  const refresh = useCallback(async (target = selected): Promise<void> => {
    setError('');
    try {
      const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const nextPlayers = parsePlayers(await request(base, `/admin/moderation/players${query}`));
      setPlayers(nextPlayers);
      await loadHistory(target);
      setStatus(`${nextPlayers.length} identit${nextPlayers.length === 1 ? 'y' : 'ies'} loaded`);
    } catch (refreshError) {
      setError(messageFor(refreshError));
      setStatus('Refresh failed');
    }
  }, [base, loadHistory, request, search, selected]);

  useEffect(() => { void refresh(); }, [refresh]);

  const select = useCallback((identity: ModerationIdentity): void => {
    setSelected(identity);
    setError('');
    void loadHistory(identity).catch(historyError => setError(messageFor(historyError)));
  }, [loadHistory]);

  const manualSelect = useCallback((): void => {
    const id = manualId.trim();
    if (!id) { setError('Enter an identity ID'); return; }
    setSearch('');
    select({ id, kind: manualKind });
  }, [manualId, manualKind, select]);

  const apply = useCallback(async (action: ModerationAction): Promise<void> => {
    if (!selected) { setError('Select or enter an identity first'); return; }
    const normalizedReason = reason.trim();
    if (!normalizedReason) { setError('A moderation reason is required'); return; }
    let durationSeconds: number | undefined;
    try {
      if (action === 'suspend') durationSeconds = durationToSeconds(duration, durationUnit);
    } catch (durationError) {
      setError(messageFor(durationError));
      return;
    }
    const label = action === 'lift' && selectedPlayer?.restriction
      ? `un${selectedPlayer.restriction.kind === 'banned' ? 'ban' : 'suspend'}`
      : action;
    if (!await confirmAction(`${label} ${canonicalIdentity(selected)}?\n\nReason: ${normalizedReason}`)) return;
    setPending(true);
    setError('');
    try {
      await request(base, '/admin/moderation/actions', {}, {
        body: JSON.stringify({
          action,
          target: selected,
          reason: normalizedReason,
          ...(durationSeconds === undefined ? {} : { duration_seconds: durationSeconds }),
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      setReason('');
      setStatus(`${label} succeeded for ${canonicalIdentity(selected)}`);
      await refresh(selected);
    } catch (mutationError) {
      setError(messageFor(mutationError));
      setStatus(`${label} failed`);
    } finally {
      setPending(false);
    }
  }, [base, confirmAction, duration, durationUnit, reason, refresh, request, selected, selectedPlayer]);

  const visiblePlayers = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return players;
    return players.filter(player => [
      canonicalIdentity(player.identity),
      player.restriction?.kind || '',
      ...player.claims.flatMap(claim => [claim.character_id, claim.character_name]),
    ].join(' ').toLowerCase().includes(normalized));
  }, [players, search]);

  const liftLabel = selectedPlayer?.restriction?.kind === 'banned' ? 'Unban'
    : selectedPlayer?.restriction?.kind === 'suspended' ? 'Unsuspend' : 'Lift';

  return <>
    <div id="toolbar">
      <div class="toolbar-row toolbar-heading">
        <span class="toolbar-brand"><img src="favicon.png" alt="" /> Bunnyland Player Moderation</span>
        <Button id="btn-client-menu" class="client-menu-button">Menu</Button>
      </div>
      <div class="toolbar-row moderation-toolbar">
        <label for="player-search">Search:</label>
        <input id="player-search" type="search" value={search} placeholder="Platform, ID, character, or restriction" onInput={event => setSearch(event.currentTarget.value)} />
        <Button disabled={pending} onClick={(): void => { void refresh(); }}>Refresh</Button>
        <span aria-live="polite" role="status">{status}</span>
      </div>
    </div>
    <div id="main" class="app-grid">
      <section class="pane" aria-labelledby="players-title">
        <div class="pane-header"><h2 class="pane-title" id="players-title">Players and clients</h2><span class="pane-count">{visiblePlayers.length}</span></div>
        <div class="manual-target">
          <strong>Explicit identity</strong>
          <div class="manual-grid">
            <select aria-label="Identity platform" value={manualKind} onChange={event => setManualKind(event.currentTarget.value as IdentityKind)}>
              <option value="discord">Discord</option><option value="web">Web account</option><option value="client">Embedding client</option>
            </select>
            <input aria-label="Identity ID" value={manualId} placeholder="ID or auth subject" onInput={event => setManualId(event.currentTarget.value)} />
          </div>
          <Button onClick={manualSelect}>Use explicit identity</Button>
          {manualKind === 'client' && <small>Client IDs are bypassable in unauthenticated embedding mode because callers choose them.</small>}
        </div>
        <div class="identity-list" role="listbox" aria-label="Known identities">
          {visiblePlayers.length === 0 ? <EmptyState>No known identities match this search.</EmptyState> : visiblePlayers.map(player => (
            <button class="identity-row" type="button" role="option" aria-selected={sameIdentity(selected, player.identity)} aria-current={sameIdentity(selected, player.identity) ? 'true' : undefined} key={canonicalIdentity(player.identity)} onClick={(): void => select(player.identity)}>
              <span><code>{canonicalIdentity(player.identity)}</code><span class="identity-meta">{player.claims.length ? player.claims.map(claim => claim.character_name || claim.character_id).join(', ') : 'No active claim'}</span></span>
              <span class="identity-badges">{player.admin && <span class="identity-badge">admin</span>}{player.restriction && <span class="identity-badge restricted">{player.restriction.kind}</span>}</span>
            </button>
          ))}
        </div>
      </section>
      <section class="pane" aria-labelledby="moderate-title">
        <div class="pane-header"><h2 class="pane-title" id="moderate-title">Moderate identity</h2></div>
        {!selected ? <EmptyState>Select a known identity or enter one explicitly.</EmptyState> : <>
          <div class="selected-summary"><code>{canonicalIdentity(selected)}</code>{selectedPlayer?.admin && ' · administrator'}{selectedPlayer?.restriction && ` · ${selectedPlayer.restriction.kind}${selectedPlayer.restriction.expires_at ? ` until ${new Date(selectedPlayer.restriction.expires_at).toLocaleString()}` : ''}`}</div>
          <div class="moderation-form">
            <label for="moderation-reason">Required reason</label>
            <textarea id="moderation-reason" required value={reason} onInput={event => setReason(event.currentTarget.value)} />
            <label for="suspension-duration">Suspension duration</label>
            <div class="duration-grid">
              <input id="suspension-duration" type="number" min="1" step="1" value={duration} onInput={event => setDuration(Number(event.currentTarget.value))} />
              <select aria-label="Suspension duration unit" value={durationUnit} onChange={event => setDurationUnit(event.currentTarget.value as DurationUnit)}>
                {Object.keys(UNIT_SECONDS).map(unit => <option key={unit} value={unit}>{unit}</option>)}
              </select>
            </div>
            <div class="action-buttons">
              <Button disabled={pending} onClick={(): void => { void apply('kick'); }}>Kick</Button>
              <Button disabled={pending} onClick={(): void => { void apply('suspend'); }}>Suspend</Button>
              <Button disabled={pending} onClick={(): void => { void apply('ban'); }}>Ban</Button>
              <Button disabled={pending || !selectedPlayer?.restriction} onClick={(): void => { void apply('lift'); }}>{liftLabel}</Button>
            </div>
            {error && <StatusText tone="error" role="alert">{error}</StatusText>}
          </div>
          <div class="pane-header"><h3 class="pane-title">Audit timeline</h3><span class="pane-count">{history.length}</span></div>
          {history.length === 0 ? <EmptyState>No moderation history for this identity.</EmptyState> : <ol class="audit-list">{history.map(entry => <li key={entry.id}><strong>{entry.action}</strong> by <code>{canonicalIdentity(entry.administrator)}</code><br /><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString()}</time>{entry.expires_at && <> · until <time dateTime={entry.expires_at}>{new Date(entry.expires_at).toLocaleString()}</time></>}<p>{entry.reason}</p></li>)}</ol>}
        </>}
      </section>
    </div>
  </>;
}

const root = document.getElementById('app');
if (root) render(<AuthProvider base={serverFromUrl() || '/api/v1'}><AuthGate scopes={['world:admin']}><ModerationPage /></AuthGate></AuthProvider>, root);
