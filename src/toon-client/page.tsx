import { serverFromUrl } from '@bunnyland/ui-web/api';
import { AuthGate, AuthProvider, Button } from '@bunnyland/ui-web/preact';
import { render } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import { useContentWarningGate } from '../content-warning';
import { StageItems } from './stage';
import type { ToonDoor, ToonSprite } from '../types';
import './toon.css';

type Json = Record<string, unknown>;
type Dynamic = (...args: unknown[]) => unknown;

export interface ToonRuntime {
  api: {
    applyConfigToInput(options: { connect: (server: unknown) => void; isConnected: () => boolean }): Promise<unknown>;
    applyServerParam(options: { connect: (server: unknown) => void }): void;
    mediaUrl(base: string, path: unknown): string;
    normalizeBase(server: unknown): string;
    requestSceneImage(base: string, characterId: string, control: Control | null): Promise<Json>;
    sendJson(base: string, path: string): Promise<unknown>;
    setServerInUrl(base: string): void;
  };
  play: Record<string, unknown>;
  ui: {
    initClientMenu(): { close?: () => void } | void;
    initHelp(options: { sections: unknown[]; title: string }): void;
  };
}

interface CharacterSummary { id: string; name: string }
interface Control extends Json { active?: boolean; characterId?: string; claimId?: string; controllerId?: string; generation?: number }
interface Entity extends Json { id: string; kind?: string; name?: string; sprite?: Json; components?: Record<string, Json> }
interface Room extends Entity { entities?: Entity[]; exits?: Array<{ direction?: string; id: string; label: string }> }
interface Projection extends Json {
  actions?: Json[];
  characterId?: string;
  inventory?: Json[];
  points?: { action?: number; action_max?: number; focus?: number; focus_max?: number };
  portrait?: { url?: string };
  room?: Room;
  targetGroups?: Record<string, Array<{ icon?: string; id?: string; kind?: string; label: string; value?: string }>>;
}
interface QueueProjection extends Json { characterId?: string; commands?: Json[] }
interface Activity { icon?: string; kind?: string; text: string }
interface ActionField { candidates?: Array<{ icon?: string; label: string; value: string }>; key: string; kind: string; label: string; required: boolean }

const CLIENT_ID_KEY = 'bunnyland.toon.clientId';
const ICON_PREF_KEY = 'bunnyland.toon.showIcons';
const ROOM_WIDTH = 100;
const ROOM_HEIGHT = 100;
const DIR_EDGE: Record<string, [number, number]> = {
  north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0],
  northeast: [1, -1], northwest: [-1, -1], southeast: [1, 1], southwest: [-1, 1],
  up: [0, -1], down: [0, 1], fore: [0, -1], aft: [0, 1], port: [-1, 0], starboard: [1, 0],
};

function playCall<T>(runtime: ToonRuntime, name: string, ...args: unknown[]): T {
  return (runtime.play[name] as Dynamic)(...args) as T;
}

function num(value: unknown): number { return Number(value) || 0; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function targetFromHash(): string {
  try { return decodeURIComponent(location.hash.replace(/^#/, '')).trim(); }
  catch { return ''; }
}

interface ActionFormProps {
  action: Json;
  fields: ActionField[];
  initialTarget: string;
  onClose: () => void;
  onSubmit: (payload: Json) => void;
  runtime: ToonRuntime;
}

function ActionForm({ action, fields, initialTarget, onClose, onSubmit, runtime }: ActionFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(field => [
    field.key, field.candidates?.some(candidate => candidate.value === initialTarget) ? initialTarget : '',
  ])));
  const [error, setError] = useState('');
  const onCloseRef = useRef(onClose);
  const submitRef = useRef<() => void>(() => undefined);
  onCloseRef.current = onClose;
  const title = playCall<string>(runtime, 'actionTitle', action);
  const submit = (): void => {
    const payload: Json = {};
    for (const field of fields) {
      const value = (values[field.key] || '').trim();
      if (field.required && !value) { setError(`${field.label} is required.`); return; }
      if (value) payload[field.key] = field.kind === 'number' ? Number(value) : field.kind === 'boolean' ? value === 'true' : value;
    }
    onSubmit(payload);
  };
  submitRef.current = submit;
  useLayoutEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCloseRef.current();
      else if (event.key === 'Enter' && event.target instanceof HTMLInputElement) submitRef.current();
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, []);
  return <div id="action-form-overlay" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div class="target-card">
      <div class="target-card-header">{title}</div>
      <div class="af-body">
        {fields.map((field, index) => <label class="af-field" key={field.key}>
          <span class="af-label">{field.label}{field.required ? ' *' : ''}</span>
          {field.candidates ? <select autoFocus={index === 0} class="af-input" value={values[field.key]} onChange={event => setValues(current => ({ ...current, [field.key]: event.currentTarget.value }))}>
            <option value="">— choose —</option>
            {field.candidates.map(candidate => <option key={candidate.value} value={candidate.value}>{candidate.icon} {candidate.label}</option>)}
          </select> : field.kind === 'boolean' ? <select autoFocus={index === 0} class="af-input" value={values[field.key]} onChange={event => setValues(current => ({ ...current, [field.key]: event.currentTarget.value }))}>
            <option value="">— choose —</option><option value="true">yes</option><option value="false">no</option>
          </select> : <input autoFocus={index === 0} class="af-input" type={field.kind === 'number' ? 'number' : 'text'} value={values[field.key]} onInput={event => setValues(current => ({ ...current, [field.key]: event.currentTarget.value }))} />}
        </label>)}
        <div class="af-error">{error}</div>
      </div>
      <div class="target-card-footer"><Button class="af-cancel" onClick={onClose}>Cancel</Button><Button class="af-submit" onClick={submit}>Submit</Button></div>
    </div>
  </div>;
}

function QueuedCountdown({ projection, runtime }: {
  projection: QueueProjection | null;
  runtime: ToonRuntime;
}) {
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const calculate = (): number | null => playCall<number | null>(
    runtimeRef.current,
    'queuedCountdownSeconds',
    projection,
  );
  const calculateRef = useRef(calculate);
  calculateRef.current = calculate;
  const [countdown, setCountdown] = useState(calculate);
  useEffect(() => {
    const update = (): void => setCountdown(calculateRef.current());
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [projection]);
  return <>{countdown == null ? '' : ` · next tick in ${countdown}s`}</>;
}

export function ToonPage({ runtime }: { runtime: ToonRuntime }) {
  const [apiUrl, setApiUrl] = useState('/api/v1/');
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('○ Offline');
  const [characterList, setCharacterList] = useState<CharacterSummary[]>([]);
  const [playerId, setPlayerId] = useState('');
  const [projection, setProjection] = useState<Projection | null>(null);
  const [roomProjection, setRoomProjection] = useState<{ entities?: Entity[]; room?: Room } | null>(null);
  const [queueProjection, setQueueProjection] = useState<QueueProjection | null>(null);
  const [control, setControl] = useState<Control | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [localPos, setLocalPos] = useState<{ x: number; y: number } | null>(null);
  const [localDirty, setLocalDirty] = useState(false);
  const [activityLines, setActivityLines] = useState<Activity[]>([]);
  const [actionFilter, setActionFilter] = useState('');
  const [showIcons, setShowIcons] = useState(() => playCall<boolean>(runtime, 'iconPreference', ICON_PREF_KEY, true));
  const [activeAction, setActiveAction] = useState<{ action: Json; fields: ActionField[] } | null>(null);
  const [eventImage, setEventImage] = useState('');
  const [lightbox, setLightbox] = useState(false);
  const [loading, setLoading] = useState(true);
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimFallback, setClaimFallback] = useState('suspend');
  const [claimController, setClaimController] = useState('');
  const [claimTimeout, setClaimTimeout] = useState('30');
  const [debugBounds, setDebugBounds] = useState(false);
  const { requireAcceptance, warningDialog } = useContentWarningGate(
    base => runtime.api.sendJson(base, '/public/world'),
  );
  const baseRef = useRef('');
  const playerRef = useRef('');
  const projectionRef = useRef<Projection | null>(null);
  const roomRef = useRef<{ entities?: Entity[]; room?: Room } | null>(null);
  const queueRef = useRef<QueueProjection | null>(null);
  const controlRef = useRef<Control | null>(null);
  const selectedRef = useRef('');
  const localPosRef = useRef<{ x: number; y: number } | null>(null);
  const activityRef = useRef<Activity[]>([]);
  const characterListRef = useRef<CharacterSummary[]>([]);
  const seenIds = useRef(new Set<string>());
  const primed = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const refreshGeneration = useRef(0);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const pendingTargetRef = useRef(targetFromHash());

  playerRef.current = playerId; projectionRef.current = projection; roomRef.current = roomProjection;
  queueRef.current = queueProjection; controlRef.current = control; localPosRef.current = localPos;
  activityRef.current = activityLines; characterListRef.current = characterList;
  selectedRef.current = selectedId;

  const projectionHasTarget = useCallback((id: string): boolean => {
    if (!id || !projectionRef.current) return false;
    return id === playerRef.current
      || (roomRef.current?.entities || roomRef.current?.room?.entities || []).some(entity => entity.id === id)
      || (projectionRef.current.inventory || []).some(item => item.id === id)
      || Object.values(projectionRef.current.targetGroups || {}).some(group => group.some(target => (target.value || target.id) === id));
  }, []);
  const selectTarget = useCallback((id: string, writeHash = true): void => {
    pendingTargetRef.current = '';
    selectedRef.current = id;
    setSelectedId(id);
    if (!writeHash) return;
    const url = new URL(location.href);
    url.hash = id ? encodeURIComponent(id) : '';
    history.pushState(null, '', url);
  }, []);

  const playerInView = useCallback(() => Boolean(playerRef.current && projectionRef.current?.room?.id && roomRef.current?.room?.id === projectionRef.current.room.id), []);
  const appendActivity = useCallback((line: Activity) => setActivityLines(current => [...current, line].slice(-8)), []);
  const refreshOnce = useCallback(async (): Promise<void> => {
    const base = baseRef.current;
    if (!base) return;
    const generation = ++refreshGeneration.current;
    let claimRequest = false;
    try {
      const lobby = await playCall<Promise<{ characters: CharacterSummary[]; epoch: number }>>(runtime, 'fetchCharacterList', base);
      if (!mounted.current || generation !== refreshGeneration.current || base !== baseRef.current) return;
      setCharacterList(lobby.characters || []);
      const id = playerRef.current;
      if (!id) { setStatus(`● Live · epoch ${lobby.epoch || 0}s`); return; }
      const currentControl = controlRef.current;
      if (!currentControl) return;
      claimRequest = true;
      const [bundle, recent] = await Promise.all([
        playCall<Promise<{ character: Projection | null; queued: QueueProjection | null; room: { entities?: Entity[]; room?: Room } | null }>>(
          runtime, 'fetchClaimProjection', base, id, currentControl,
        ),
        playCall<Promise<Json>>(runtime, 'fetchCharacterRecentEvents', base, id, currentControl),
      ]);
      if (!mounted.current || generation !== refreshGeneration.current || base !== baseRef.current || playerRef.current !== id) return;
      const character = bundle.character;
      if (!character) return;
      const queued = bundle.queued;
      projectionRef.current = character;
      setProjection(character);
      const synced = playCall<Control>(runtime, 'syncClaimControl', currentControl, character, id);
      controlRef.current = synced;
      setControl(synced);
      queueRef.current = queued;
      setQueueProjection(queued);
      const roomId = character.room?.id;
      const room = roomId ? bundle.room : null;
      roomRef.current = room;
      setRoomProjection(room);
      const drained = playCall<{ lines: Activity[]; seenIds: Set<string> }>(runtime, 'drainNarratedEvents', Array.isArray(recent.events) ? recent.events : [], {
        seenIds: seenIds.current, playerId: id, roomOf: () => character.room?.id || null, nameFor: () => null,
      });
      seenIds.current = drained.seenIds;
      if (primed.current) for (const line of drained.lines) appendActivity(line);
      primed.current = true;
      const latest = playCall<{ url?: string } | null>(runtime, 'latestImageCompletion', Array.isArray(recent.events) ? recent.events : [], { base, purpose: 'event' });
      if (latest?.url) setEventImage(latest.url);
      setStatus('● Live');
    } catch (error) {
      if (!mounted.current || generation !== refreshGeneration.current || base !== baseRef.current) return;
      const id = playerRef.current;
      if (claimRequest && id && playCall<boolean>(runtime, 'isClaimNotFoundError', error)) {
        playCall(runtime, 'clearClaimControl', CLIENT_ID_KEY, id);
        controlRef.current = null; projectionRef.current = null; queueRef.current = null; roomRef.current = null;
        selectedRef.current = ''; localPosRef.current = null; primed.current = false; seenIds.current = new Set();
        setControl(null); setProjection(null); setQueueProjection(null); setRoomProjection(null);
        setSelectedId(''); setLocalPos(null); setLocalDirty(false);
        setStatus('⚠ Claim expired. Claim again to continue.');
        return;
      }
      setStatus(`⚠ ${errorMessage(error)}`);
    }
  }, [appendActivity, runtime]);
  const refresh = useCallback((): Promise<void> => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const request = refreshOnce();
    refreshPromiseRef.current = request;
    const clear = (): void => {
      if (refreshPromiseRef.current === request) refreshPromiseRef.current = null;
    };
    void request.then(clear, clear);
    return request;
  }, [refreshOnce]);

  const postCommand = useCallback(async (action: Json, payload: Json): Promise<boolean> => {
    const currentControl = playCall<Control | null>(runtime, 'playerControl', controlRef.current, projectionRef.current, playerRef.current);
    if (!baseRef.current || !currentControl) return false;
    const cost = playCall<{ action: number; focus: number }>(runtime, 'actionCost', action);
    const result = await playCall<Promise<Json>>(runtime, 'submitCommand', baseRef.current, {
      character_id: playerRef.current,
      controller_id: currentControl.controllerId,
      controller_generation: currentControl.generation,
      ...(currentControl.claimId ? { claim_id: currentControl.claimId } : {}),
      command_type: String(action.command_type || playCall<string>(runtime, 'actionTool', action)),
      payload, cost, lane: playCall<string>(runtime, 'actionLane', action), on_insufficient_points: 'queue',
    }, currentControl);
    if (result.queued === false) { appendActivity({ text: String(result.reason || 'Command rejected.'), kind: 'rejection' }); return false; }
    await refresh();
    return true;
  }, [appendActivity, refresh, runtime]);

  const claim = useCallback(async (id: string): Promise<void> => {
    try {
      const clientId = await playCall<Promise<string>>(runtime, 'persistentClientId', CLIENT_ID_KEY, 'toon');
      const stored = playCall<Control | null>(runtime, 'storedClaimControl', CLIENT_ID_KEY, id);
      const data = await playCall<Promise<Json>>(runtime, 'claimWebController', baseRef.current, {
        ...playCall<Json>(runtime, 'claimSettings'), character_id: id, client_id: clientId,
        claim_id: stored?.claimId || undefined, label: 'toon',
      }, stored);
      const next = playCall<Control>(runtime, 'controlFromResponse', data, id, { active: true });
      playCall(runtime, 'storeClaimControl', CLIENT_ID_KEY, next);
      if (mounted.current && playerRef.current === id) { controlRef.current = next; setControl(next); await refresh(); }
    } catch (error) { if (mounted.current) setStatus(`⚠ ${errorMessage(error)}`); }
  }, [refresh, runtime]);

  const selectPlayer = async (id: string): Promise<void> => {
    if (id) {
      try {
        if (!await requireAcceptance(baseRef.current)) return;
      } catch (error) {
        setStatus(`⚠ ${errorMessage(error)}`);
        return;
      }
    }
    refreshGeneration.current += 1;
    refreshPromiseRef.current = null;
    playerRef.current = id;
    setPlayerId(id); setProjection(null); setRoomProjection(null); setQueueProjection(null);
    setControl(null); setSelectedId(''); setLocalPos(null); setActivityLines([]); primed.current = false; seenIds.current = new Set();
    if (id) await claim(id); else await refresh();
  };

  const updateFallback = async (): Promise<void> => {
    if (!playerId || !controlRef.current) return;
    try {
      const clientId = await playCall<Promise<string>>(runtime, 'persistentClientId', CLIENT_ID_KEY, 'toon');
      const data = await playCall<Promise<Json>>(runtime, 'updateWebControllerFallback', baseRef.current, {
        ...playCall<Json>(runtime, 'claimSettings'), character_id: playerId, client_id: clientId, claim_id: controlRef.current.claimId,
      }, controlRef.current);
      const next = playCall<Control>(runtime, 'controlFromResponse', data, playerId, { active: controlRef.current.active !== false });
      controlRef.current = next; setControl(next); playCall(runtime, 'storeClaimControl', CLIENT_ID_KEY, next); setStatus('● Idle settings saved');
    } catch (error) { setStatus(`⚠ ${errorMessage(error)}`); }
  };
  const releaseController = async (): Promise<void> => {
    if (!playerId || !controlRef.current) return;
    try {
      const clientId = await playCall<Promise<string>>(runtime, 'persistentClientId', CLIENT_ID_KEY, 'toon');
      const data = await playCall<Promise<Json>>(runtime, 'releaseWebController', baseRef.current, {
        ...playCall<Json>(runtime, 'claimSettings'), character_id: playerId, client_id: clientId, claim_id: controlRef.current.claimId,
      }, controlRef.current);
      const next = playCall<Control>(runtime, 'controlFromResponse', data, playerId, { active: false });
      controlRef.current = next; setControl(next); playCall(runtime, 'storeClaimControl', CLIENT_ID_KEY, next); await refresh();
    } catch (error) { setStatus(`⚠ ${errorMessage(error)}`); }
  };
  const releaseClaim = async (): Promise<void> => {
    if (!playerId || !controlRef.current) return;
    try {
      const id = playerId;
      const clientId = await playCall<Promise<string>>(runtime, 'persistentClientId', CLIENT_ID_KEY, 'toon');
      await playCall<Promise<Json>>(runtime, 'releaseWebClaim', baseRef.current, {
        character_id: id, client_id: clientId, claim_id: controlRef.current.claimId,
      }, controlRef.current);
      playCall(runtime, 'clearClaimControl', CLIENT_ID_KEY, id); setClaimOpen(false); selectPlayer('');
    } catch (error) { setStatus(`⚠ ${errorMessage(error)}`); }
  };
  const requestImage = async (): Promise<void> => {
    if (!baseRef.current || !playerId) { setStatus('⚠ Select a character before requesting an image.'); return; }
    try {
      const result = await runtime.api.requestSceneImage(baseRef.current, playerId, controlRef.current);
      setStatus(playCall<string>(runtime, 'imageRequestMessage', result));
      if (result.url) setEventImage(String(runtime.api.mediaUrl(baseRef.current, result.url)));
    } catch (error) { setStatus(`⚠ ${errorMessage(error)}`); }
  };
  const openSheet = (): void => {
    if (!baseRef.current || !playerId) { setStatus('⚠ Select a character before opening a sheet.'); return; }
    const target = selectedId && characterList.some(character => character.id === selectedId) ? selectedId : playerId;
    const href = playCall<string>(runtime, 'characterHref', baseRef.current, target);
    const opened = window.open(href, '_blank', 'noopener');
    setStatus(opened ? '● Opened character sheet.' : `⚠ Sheet URL: ${href}`);
  };

  useEffect(() => {
    mounted.current = true;
    runtime.ui.initClientMenu();
    runtime.ui.initHelp({ title: 'Bunnyland Toon — controls', sections: [] });
    const connect = (server: unknown): void => {
      const base = String(runtime.api.normalizeBase(server) || '');
      if (!base) return;
      refreshGeneration.current += 1; refreshPromiseRef.current = null;
      baseRef.current = base; setApiUrl(base); setConnected(true); setStatus('● Connected'); setLoading(false);
      runtime.api.setServerInUrl(base); void refresh();
    };
    runtime.api.applyServerParam({ connect });
    void runtime.api.applyConfigToInput({ connect, isConnected: () => Boolean(baseRef.current) });
    const loadingTimer = window.setTimeout(() => setLoading(false), 1850);
    const poll = window.setInterval(() => {
      if (baseRef.current && (!playerRef.current || !controlRef.current)) void refresh();
    }, 2000);
    const applyTargetHash = (): void => {
      const id = targetFromHash();
      if (!id) { pendingTargetRef.current = ''; selectTarget('', false); return; }
      if (projectionHasTarget(id)) selectTarget(id, false);
      else { pendingTargetRef.current = id; selectedRef.current = ''; setSelectedId(''); }
    };
    window.addEventListener('hashchange', applyTargetHash);
    window.addEventListener('popstate', applyTargetHash);
    return () => {
      mounted.current = false; refreshGeneration.current += 1; window.clearTimeout(loadingTimer); window.clearInterval(poll);
      window.removeEventListener('hashchange', applyTargetHash); window.removeEventListener('popstate', applyTargetHash);
    };
  }, [projectionHasTarget, refresh, runtime, selectTarget]);

  useEffect(() => {
    const id = pendingTargetRef.current;
    if (id && projectionHasTarget(id)) selectTarget(id, false);
  }, [projection, projectionHasTarget, roomProjection, selectTarget]);

  const controlSubscriptionKey = control
    ? [control.claimId, control.clientId].join(':')
    : '';

  useEffect(() => {
    const currentControl = controlRef.current;
    if (!connected || !playerId || !controlSubscriptionKey || !currentControl) return;
    const live = playCall<{ close: () => void }>(runtime, 'createPlayerLiveUpdates', {
      base: baseRef.current, characterId: playerId, control: currentControl, refresh, onState: (state: string) => {
        if (mounted.current && state === 'live') setStatus('● Live');
        else if (mounted.current && state !== 'closed') setStatus('◌ Reconnecting · polling');
      },
    });
    return () => live.close();
  }, [connected, controlSubscriptionKey, playerId, refresh, runtime]);

  useEffect(() => {
    const facade = {
      get characterList(): CharacterSummary[] { return characterListRef.current; },
      get characterProjection(): Projection | null { return projectionRef.current; },
      get control(): Control | null { return controlRef.current; },
      get localPos(): { x: number; y: number } | null { return localPosRef.current; },
      get activityLines(): Activity[] { return activityRef.current; },
      _playerInView: playerInView,
      _refresh: refresh,
    };
    (window as unknown as { app?: typeof facade }).app = facade;
    return () => { delete (window as unknown as { app?: typeof facade }).app; };
  }, [playerInView, refresh]);

  useEffect(() => {
    const sync = window.setInterval(() => {
      if (!localDirty || !localPosRef.current) return;
      setLocalDirty(false);
      const move = { command_type: 'move-sprite', tool_name: 'move-sprite', lane: 'world', cost: { action: 0, focus: 0 } };
      void postCommand(move, localPosRef.current).then(ok => { if (!ok) setLocalDirty(true); });
    }, 500);
    return () => window.clearInterval(sync);
  }, [localDirty, postCommand]);

  const actions = projection?.actions || [];
  const filtered = playCall<Json[]>(runtime, 'filterActions', actions, actionFilter);
  const points = projection?.points;
  const openAction = (action: Json): void => {
    if (activeAction) return;
    const fields = playCall<ActionField[]>(runtime, 'actionFields', action, (group: string) => projection?.targetGroups?.[group] || []);
    if (fields.length) setActiveAction({ action, fields });
    else void postCommand(action, {});
  };
  const commands = queueProjection?.commands || [];
  const room = roomProjection?.room;
  const rect = stageRef.current?.getBoundingClientRect();
  const members = roomProjection?.entities || room?.entities || [];
  const sprites: ToonSprite[] = members.map(entity => {
    const position = entity.sprite?.position as { x?: number; y?: number } | undefined;
    const pos = entity.id === playerId && localPos ? localPos : { x: num(position?.x), y: num(position?.y) };
    return {
      id: entity.id, glyph: playCall<string>(runtime, 'entityIcon', entity), imageUrl: String(entity.sprite?.image_url || ''),
      isPlayer: entity.id === playerId, label: playCall<string>(runtime, 'entityName', entity), layer: num(entity.sprite?.layer) || 20,
      left: (pos.x / ROOM_WIDTH) * (rect?.width || 800), top: (pos.y / ROOM_HEIGHT) * (rect?.height || 600), scale: num(entity.sprite?.scale) || 1,
      selected: entity.id === selectedId,
    };
  });
  const doors: ToonDoor[] = (room?.exits || []).map(exit => {
    const direction = (exit.direction || '').toLowerCase(); const [x, y] = DIR_EDGE[direction] || [1, 0]; const margin = '14px';
    return { id: exit.id, direction, label: exit.label, position: {
      ...(x === 0 ? { left: '50%' } : x < 0 ? { left: margin } : { right: margin }),
      ...(y === 0 ? { top: '50%' } : y < 0 ? { top: margin } : { bottom: margin }),
    }, title: `Walk through ${exit.label}`,
    ...(x === 0 ? { transform: 'translateX(-50%)' } : y === 0 ? { transform: 'translateY(-50%)' } : {}) };
  });

  return <>
    {loading && <div id="loading-overlay"><div class="loading-card"><div class="loading-title">Bunnyland</div><pre class="loading-bunny"> /)_/\\{`\n`}( =.= ){`\n`} )   ({`\n`}(__ __)</pre></div></div>}
    <div id="toolbar"><div class="toolbar-row toolbar-heading" id="toolbar-row1">
      <span class="toolbar-brand"><img src="favicon.png" alt="" /> Bunnyland Toon</span>
      <Button id="btn-client-menu" class="client-menu-button">Menu</Button><Button id="btn-help">?</Button>
    </div><div class="toolbar-row" id="toolbar-row2">
      <label for="api-url">Server:</label><input id="api-url" value={apiUrl} onInput={event => setApiUrl(event.currentTarget.value)} />
      <Button id="btn-connect" onClick={() => {
        if (connected) { baseRef.current = ''; setConnected(false); setStatus('○ Offline'); setProjection(null); setRoomProjection(null); runtime.api.setServerInUrl(''); }
        else { const base = String(runtime.api.normalizeBase(apiUrl) || ''); baseRef.current = base; setConnected(true); setLoading(false); setStatus('● Connected'); runtime.api.setServerInUrl(base); void refresh(); }
      }}>{connected ? 'Disconnect' : 'Connect Live'}</Button><span id="api-status">{status}</span>
    </div><div class="toolbar-row" id="toolbar-row3">
      <label for="player-select">Character:</label><select id="player-select" value={playerId} onChange={event => { void selectPlayer(event.currentTarget.value); }}>
        <option value="">— select to play —</option>{[...characterList].sort((a, b) => a.name.localeCompare(b.name)).map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
      </select><Button id="btn-release-character" disabled={!playerId} onClick={() => setClaimOpen(true)}>{control?.active === false ? 'Resume' : control ? 'Idle' : 'Claim'}</Button>
      <Button id="btn-request-image" onClick={() => { void requestImage(); }}>📷 Image</Button>
      <Button id="btn-open-sheet" onClick={openSheet}>▣ Sheet</Button><Button id="btn-follow" onClick={() => { setLocalPos(null); void refresh(); stageRef.current?.focus(); }}>⌖ Follow character</Button><span class="toolbar-sep">|</span>
      <label><input type="checkbox" id="debug-bounds" checked={debugBounds} onChange={event => setDebugBounds(event.currentTarget.checked)} /> Bounds</label><span class="toolbar-sep">|</span><span id="room-title">{room ? playCall<string>(runtime, 'entityName', room) : connected ? 'No room' : 'Not connected'}</span>
    </div></div>
    <dialog id="claim-dialog" open={claimOpen}><form method="dialog" class="claim-dialog-form" onSubmit={() => setClaimOpen(false)}><h3>Claim</h3>
      <label for="claim-fallback">Idle controller</label><select id="claim-fallback" value={claimFallback} onChange={event => setClaimFallback(event.currentTarget.value)}><option value="suspend">Suspended</option><option value="llm">LLM</option><option value="controller">Existing controller</option></select>
      <label for="claim-fallback-controller">Idle controller ID</label><input type="text" id="claim-fallback-controller" spellcheck={false} placeholder="entity_..." value={claimController} onInput={event => setClaimController(event.currentTarget.value)} />
      <label for="claim-timeout">Idle timeout minutes</label><input type="number" id="claim-timeout" min="5" max="60" step="1" value={claimTimeout} onInput={event => setClaimTimeout(event.currentTarget.value)} />
      <div class="dialog-actions"><Button id="btn-dialog-claim" onClick={() => { void claim(playerId); }}>{control?.active === false ? 'Resume' : 'Claim'}</Button><Button id="btn-dialog-save-fallback" onClick={() => { void updateFallback(); }}>Save Idle</Button><Button id="btn-dialog-release-controller" onClick={() => { void releaseController(); }}>Idle</Button><Button id="btn-dialog-release-claim" onClick={() => { void releaseClaim(); }}>Release</Button><Button onClick={() => setClaimOpen(false)}>Close</Button></div>
    </form></dialog>
    <div id="main" class="app-split">
      <div id="stage-wrapper">{activeAction && <ActionForm runtime={runtime} {...activeAction} initialTarget={selectedId} onClose={() => setActiveAction(null)} onSubmit={payload => { const action = activeAction.action; setActiveAction(null); void postCommand(action, payload); }} />}
        <div id="stage" class={debugBounds ? 'debug-bounds' : ''} ref={stageRef} tabIndex={0} onKeyDown={event => {
          if (!playerInView()) return;
          const deltas: Record<string, [number, number]> = {
            ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1],
            ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0],
          };
          const delta = deltas[event.key];
          if (!delta) return;
          event.preventDefault();
          const player = members.find(entity => entity.id === playerId);
          const position = player?.sprite?.position as { x?: number; y?: number } | undefined;
          const current = localPosRef.current || { x: num(position?.x), y: num(position?.y) };
          setLocalPos({ x: current.x + delta[0] * 4, y: current.y + delta[1] * 4 });
          setLocalDirty(true);
        }} onClick={event => {
          if (!playerInView() || !stageRef.current || event.target !== event.currentTarget) return;
          const box = stageRef.current.getBoundingClientRect(); setLocalPos({ x: ((event.clientX - box.left) / box.width) * ROOM_WIDTH, y: ((event.clientY - box.top) / box.height) * ROOM_HEIGHT }); setLocalDirty(true);
        }}><div id="room-bg">{room ? `“${playCall<string>(runtime, 'entityName', room)}”` : ''}</div><div id="stage-items"><StageItems sprites={sprites} doors={doors} onSprite={id => selectTarget(selectedRef.current === id ? '' : id)} onDoor={id => {
          const action = actions.find(item => playCall<Json[]>(runtime, 'actionArguments', item).some(argument => argument.target_group === 'exits'));
          const argument = action && playCall<Json[]>(runtime, 'actionArguments', action).find(item => item.target_group === 'exits');
          if (action && argument) void postCommand(action, { [String(argument.key)]: id });
        }} /></div></div>
        <div id="stage-hint">{playerInView() ? 'Click or use arrow keys / WASD to move · click a door to walk to the next room' : 'Select a character to move'}</div>
        <div id="stage-empty" class={room ? 'hidden' : ''}><div class="title">No room to show</div><div>Connect to a running server, then select a character to play as.</div></div>
      </div>
      <div id="actions"><div id="actions-header">⚔ Actions</div>
        {projection?.portrait?.url && <img id="player-portrait" src={String(runtime.api.mediaUrl(baseRef.current, projection.portrait.url))} alt="Your character's portrait" />}
        {eventImage && <img id="event-image" src={eventImage} alt="Latest requested scene image" onClick={() => setLightbox(true)} />}
        <div id="actions-body"><div id="pt-summary">{points ? <><span class="pt ap">⚡ {num(points.action)} / {num(points.action_max)} AP</span><span class="pt fp">🔹 {num(points.focus)} / {num(points.focus_max)} FP</span></> : <span class="pt-empty">Select a character to play as and see their actions.</span>}</div>
          <div id="target-line"><span>Target: {selectedId || '—'}</span><Button id="btn-clear-target" disabled={!selectedId} onClick={() => selectTarget('')}>Clear Target</Button></div>
          <div id="action-filter-row"><input id="action-filter" value={actionFilter} placeholder="Search actions" onInput={event => setActionFilter(event.currentTarget.value)} /><Button id="action-filter-clear" onClick={() => setActionFilter('')}>Clear</Button><label class="icon-toggle"><input id="show-action-icons" type="checkbox" checked={showIcons} onChange={event => { setShowIcons(event.currentTarget.checked); playCall(runtime, 'setIconPreference', ICON_PREF_KEY, event.currentTarget.checked); }} /> Icons</label></div>
          {['world', 'focus'].map(lane => <div key={lane}><div class="action-section-title">{lane === 'world' ? 'World actions' : 'Focus actions'}</div><div class="verb-list">{filtered.filter(action => playCall<string>(runtime, 'actionLane', action) === lane).map(action => {
            const tool = playCall<string>(runtime, 'actionTool', action); const cost = playCall<{ action: number; focus: number }>(runtime, 'actionCost', action); const available = playCall<boolean>(runtime, 'actionAvailable', action); const reason = playCall<string>(runtime, 'actionUnavailableReason', action); const targeted = playCall<Json[]>(runtime, 'actionArguments', action).some(arg => arg.target_group);
            return <div class={`verb ready${available ? '' : ' unavailable'}`} data-tool={tool} key={tool} onClick={() => openAction(action)}><span class="verb-name">{showIcons && <span class="action-icon">{playCall<string>(runtime, 'actionIcon', action)}</span>}{playCall<string>(runtime, 'actionTitle', action)}</span><span class="verb-cost">{targeted && <span class="verb-note">⌖ target</span>}{cost.action ? <span class="cost ap">{cost.action} AP</span> : null}{cost.focus ? <span class="cost fp">{cost.focus} FP</span> : null}{!cost.action && !cost.focus && <span class="cost free">free</span>}{reason && <span class="verb-reason">{reason}</span>}</span></div>;
          })}</div></div>)}
          <div class="action-section-title">Inventory</div><div class="inventory-list">{playCall<Array<{ icon: string; id: string; kind: string; label: string }>>(runtime, 'inventoryEntries', projection).map(item => <Button class={`inventory-item${selectedId === item.id ? ' selected' : ''}`} key={item.id} onClick={() => selectTarget(selectedRef.current === item.id ? '' : item.id)}><span class="verb-name">{showIcons && item.icon} {item.label}</span><span class="inventory-item-kind">{item.kind}</span></Button>)}</div>
          <div id="queued-title" class="action-section-title">Queued actions<QueuedCountdown projection={queueProjection} runtime={runtime} /></div><div class="queued-list">{commands.length ? commands.map(command => <Button class="queued-action" data-cancel-command={String(command.command_id || '')} key={String(command.command_id)} onClick={() => { void playCall<Promise<Json>>(runtime, 'cancelQueuedCommand', baseRef.current, playerId, command.command_id, controlRef.current).then(refresh); }}><div class="queued-action-head"><span class="queued-action-name">{playCall<string>(runtime, 'queuedCommandName', command, actions)}</span><span class="queued-action-lane">{String(command.lane || '')}</span></div><div class="queued-action-detail">{[playCall<string>(runtime, 'queuedCommandCost', command), playCall<string>(runtime, 'queuedCommandDetail', command)].filter(Boolean).join(' · ')}</div></Button>) : <div class="queued-empty">No queued actions.</div>}</div>
          <div class="action-section-title">Activity</div><div class="activity-list">{activityLines.length ? activityLines.map((line, index) => <div class={`activity-row ${line.kind ? `kind-${line.kind}` : ''}`} key={`${line.text}:${index}`}>{showIcons && line.icon} {line.text}</div>) : <div class="activity-empty">No recent activity.</div>}</div>
        </div>
      </div>{lightbox && <div id="image-lightbox" onClick={() => setLightbox(false)}><img src={eventImage} alt="Requested scene image" /></div>}
    </div>
    {warningDialog}
  </>;
}

interface BrowserWindow extends Window { BunnylandApi: ToonRuntime['api']; BunnylandPlay: ToonRuntime['play']; BunnylandUI: ToonRuntime['ui'] }
const root = document.getElementById('app');
if (root) {
  const browser = window as unknown as BrowserWindow;
  render(
    <AuthProvider base={serverFromUrl() || '/api/v1'}>
      <AuthGate scopes={['world:play']}>
        <ToonPage runtime={{ api: browser.BunnylandApi, play: browser.BunnylandPlay, ui: browser.BunnylandUI }} />
      </AuthGate>
    </AuthProvider>,
    root,
  );
}
