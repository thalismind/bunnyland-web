import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import './content-warning.css';

const IGNORED_CONTENT_FLAGS_KEY = 'bunnyland.contentFlags.ignore';
const WORLD_INTRO_PREFERENCES_KEY = 'bunnyland.worldIntro.preferences';
const CONTENT_FLAG_PATTERN = /^[a-z][a-z0-9_]*(?::[a-z][a-z0-9_]*)*$/;

export interface PublicWorldResource {
  contentFlags: string[];
  description: string;
  title: string;
  worldEpoch: number;
  worldId: string;
}

interface PendingWarning {
  base: string;
  flags: string[];
  requestId: number;
  resource: PublicWorldResource;
  signature: string;
  type: 'warning';
}

interface PendingWorldIntro {
  base: string;
  requestId: number;
  resource: PublicWorldResource;
  type: 'intro';
}

interface ContentWarningDialogProps {
  flags: string[];
  onAccept: (remember: boolean) => void;
  onDecline: () => void;
}

interface WorldIntroDialogProps {
  onContinue: (skip: WorldIntroSkip) => void;
  world: PublicWorldResource;
}

interface WorldIntroPreferences {
  skipAll: boolean;
  worlds: string[];
}

type PendingGate = PendingWarning | PendingWorldIntro;
type WorldIntroSkip = 'none' | 'world' | 'all';

export type ContentFlagsFetcher = (base: string) => Promise<unknown>;

function normalizeFlags(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(value => value.length <= 64 && CONTENT_FLAG_PATTERN.test(value)))]
    .sort((left, right) => left.localeCompare(right));
}

export function publicWorldFromResource(resource: unknown): PublicWorldResource {
  if (
    !resource
    || typeof resource !== 'object'
    || !('world_id' in resource)
    || typeof resource.world_id !== 'string'
    || !('world_epoch' in resource)
    || typeof resource.world_epoch !== 'number'
    || !Number.isInteger(resource.world_epoch)
    || !('title' in resource)
    || typeof resource.title !== 'string'
    || !('description' in resource)
    || typeof resource.description !== 'string'
    || !('content_flags' in resource)
    || !Array.isArray(resource.content_flags)
    || resource.content_flags.some(value => (
      typeof value !== 'string'
      || value.trim().length > 64
      || !CONTENT_FLAG_PATTERN.test(value.trim())
    ))
  ) {
    throw new Error('invalid public world resource');
  }
  return {
    contentFlags: normalizeFlags(resource.content_flags),
    description: resource.description,
    title: resource.title,
    worldEpoch: resource.world_epoch,
    worldId: resource.world_id,
  };
}

export function contentFlagsFromResource(resource: unknown): string[] {
  return publicWorldFromResource(resource).contentFlags;
}

export function ignoredContentFlags(): string[] {
  try { return normalizeFlags(JSON.parse(localStorage.getItem(IGNORED_CONTENT_FLAGS_KEY) || '[]'));
  } catch { return []; }
}

function rememberIgnoredContentFlags(flags: string[]): void {
  try {
    localStorage.setItem(
      IGNORED_CONTENT_FLAGS_KEY,
      JSON.stringify(normalizeFlags([...ignoredContentFlags(), ...flags])),
    );
  } catch {
    // Browser preferences are best-effort; acceptance still applies to this session.
  }
}

function worldIntroScope(base: string, worldId: string): string {
  return `${base.replace(/\/+$/, '')}\n${worldId}`;
}

function worldIntroPreferences(): WorldIntroPreferences {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(WORLD_INTRO_PREFERENCES_KEY) || '{}',
    );
    if (!value || typeof value !== 'object') return { skipAll: false, worlds: [] };
    const skipAll = 'skipAll' in value && value.skipAll === true;
    const worlds = 'worlds' in value && Array.isArray(value.worlds)
      ? [...new Set(value.worlds.filter((scope): scope is string => (
          typeof scope === 'string' && scope.length <= 2048
        )))]
      : [];
    return { skipAll, worlds };
  } catch {
    return { skipAll: false, worlds: [] };
  }
}

export function shouldSkipWorldIntro(base: string, worldId: string): boolean {
  const preferences = worldIntroPreferences();
  return preferences.skipAll || preferences.worlds.includes(worldIntroScope(base, worldId));
}

function rememberWorldIntroSkip(
  base: string,
  worldId: string,
  skip: WorldIntroSkip,
): void {
  if (skip === 'none') return;
  try {
    const preferences = worldIntroPreferences();
    if (skip === 'all') preferences.skipAll = true;
    if (skip === 'world') {
      preferences.worlds = [
        ...new Set([...preferences.worlds, worldIntroScope(base, worldId)]),
      ];
    }
    localStorage.setItem(WORLD_INTRO_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Browser preferences are best-effort; continuing still applies to this session.
  }
}

export function ContentWarningDialog({ flags, onAccept, onDecline }: ContentWarningDialogProps) {
  const [remember, setRemember] = useState(false);
  return <div class="content-warning-backdrop">
    <dialog
      class="content-warning-dialog"
      open
      aria-labelledby="content-warning-title"
      onCancel={(event) => { event.preventDefault(); onDecline(); }}
    >
      <h2 id="content-warning-title">Content warning</h2>
      <p>This world may contain the following content. You must accept this warning before joining.</p>
      <ul>{flags.map(flag => <li key={flag}>{flag}</li>)}</ul>
      <label class="content-warning-ignore">
        <input type="checkbox" checked={remember} onChange={event => setRemember(event.currentTarget.checked)} />
        <span>Ignore these flags in this browser after I accept.</span>
      </label>
      <div class="dialog-actions">
        <button type="button" onClick={onDecline}>Leave</button>
        <button type="button" class="primary" onClick={() => onAccept(remember)}>Accept and Join</button>
      </div>
    </dialog>
  </div>;
}

export function WorldIntroDialog({ onContinue, world }: WorldIntroDialogProps) {
  const [skipWorld, setSkipWorld] = useState(false);
  const [skipAll, setSkipAll] = useState(false);
  const skip: WorldIntroSkip = skipAll ? 'all' : skipWorld ? 'world' : 'none';
  return <div class="content-warning-backdrop">
    <dialog
      class="content-warning-dialog world-intro-dialog"
      open
      aria-labelledby="world-intro-title"
      onCancel={event => event.preventDefault()}
    >
      <h2 id="world-intro-title">{world.title}</h2>
      <p class="world-intro-description">{world.description}</p>
      <fieldset class="world-intro-options">
        <legend>Future loads</legend>
        <label>
          <input
            type="checkbox"
            checked={skipWorld}
            onChange={event => {
              setSkipWorld(event.currentTarget.checked);
              if (event.currentTarget.checked) setSkipAll(false);
            }}
          />
          <span>Skip this introduction for this world and server.</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={skipAll}
            onChange={event => {
              setSkipAll(event.currentTarget.checked);
              if (event.currentTarget.checked) setSkipWorld(false);
            }}
          />
          <span>Skip introductions for all worlds and servers.</span>
        </label>
      </fieldset>
      <div class="dialog-actions">
        <button type="button" class="primary" onClick={() => onContinue(skip)}>Continue</button>
      </div>
    </dialog>
  </div>;
}

export function useContentWarningGate(fetchContentFlags: ContentFlagsFetcher) {
  const [pending, setPending] = useState<PendingGate | null>(null);
  const accepted = useRef(new Map<string, string>());
  const introduced = useRef(new Set<string>());
  const nextRequestId = useRef(0);
  const resolver = useRef<{ requestId: number; resolve: (accepted: boolean) => void } | null>(null);

  useEffect(() => () => {
    nextRequestId.current += 1;
    resolver.current?.resolve(false);
    resolver.current = null;
  }, []);

  const requireAcceptance = useCallback(async (base: string): Promise<boolean> => {
    const requestId = ++nextRequestId.current;
    resolver.current?.resolve(false);
    resolver.current = null;
    setPending(null);
    let resource: unknown;
    try {
      resource = await fetchContentFlags(base);
    } catch (error) {
      if (requestId !== nextRequestId.current) return false;
      throw error;
    }
    if (requestId !== nextRequestId.current) return false;
    const world = publicWorldFromResource(resource);
    const flags = world.contentFlags;
    const signature = flags.join('\n');
    const introScope = worldIntroScope(base, world.worldId);
    const warningAccepted = accepted.current.get(introScope) === signature;
    const ignored = new Set(ignoredContentFlags());
    const visible = flags.filter(flag => !ignored.has(flag));
    if (!visible.length || warningAccepted) {
      accepted.current.set(introScope, signature);
      if (introduced.current.has(introScope) || shouldSkipWorldIntro(base, world.worldId)) {
        return true;
      }
      return new Promise<boolean>((resolve) => {
        if (requestId !== nextRequestId.current) {
          resolve(false);
          return;
        }
        resolver.current = { requestId, resolve };
        setPending({ base, requestId, resource: world, type: 'intro' });
      });
    }
    return new Promise<boolean>((resolve) => {
      if (requestId !== nextRequestId.current) {
        resolve(false);
        return;
      }
      resolver.current = { requestId, resolve };
      setPending({
        base,
        flags: visible,
        requestId,
        resource: world,
        signature,
        type: 'warning',
      });
    });
  }, [fetchContentFlags]);

  const settleWarning = useCallback((requestId: number, allow: boolean, remember: boolean): void => {
    const active = resolver.current;
    if (!pending || pending.type !== 'warning' || !active || active.requestId !== requestId) {
      return;
    }
    if (!allow) {
      resolver.current = null;
      setPending(null);
      active.resolve(false);
      return;
    }
    if (remember) rememberIgnoredContentFlags(pending.flags);
    const introScope = worldIntroScope(pending.base, pending.resource.worldId);
    accepted.current.set(introScope, pending.signature);
    if (
      introduced.current.has(introScope)
      || shouldSkipWorldIntro(pending.base, pending.resource.worldId)
    ) {
      resolver.current = null;
      setPending(null);
      active.resolve(true);
      return;
    }
    setPending({
      base: pending.base,
      requestId,
      resource: pending.resource,
      type: 'intro',
    });
  }, [pending]);

  const settleIntro = useCallback((requestId: number, skip: WorldIntroSkip): void => {
    const active = resolver.current;
    if (!pending || pending.type !== 'intro' || !active || active.requestId !== requestId) {
      return;
    }
    rememberWorldIntroSkip(pending.base, pending.resource.worldId, skip);
    introduced.current.add(worldIntroScope(pending.base, pending.resource.worldId));
    resolver.current = null;
    setPending(null);
    active.resolve(true);
  }, [pending]);

  return {
    requireAcceptance,
    warningDialog: pending
      ? pending.type === 'warning'
        ? <ContentWarningDialog
          key={pending.requestId}
          flags={pending.flags}
          onAccept={remember => settleWarning(pending.requestId, true, remember)}
          onDecline={() => settleWarning(pending.requestId, false, false)}
        />
        : <WorldIntroDialog
          key={pending.requestId}
          world={pending.resource}
          onContinue={skip => settleIntro(pending.requestId, skip)}
        />
      : null,
  };
}
