import {
  AuthGate,
  AuthProvider,
  Button,
  StatusText,
  Toolbar,
  ToolbarBrand,
  ToolbarRow,
} from '@bunnyland/ui-web/preact';
import { serverFromUrl } from '@bunnyland/ui-web/api';
import type {
  ActionArgument,
  ActionView,
  CharacterProjection,
  CharacterSummary,
  ControlClaim,
  QueuedCommand,
  QueuedProjection,
  TargetOption,
} from '@bunnyland/ui-web/play';
import { render } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { useContentWarningGate } from '../content-warning';
import { useSecondBoundaryTick } from '../use-second-boundary-tick';
import { ActionRows, TargetRows, type ReplActionRow, type ReplTargetRow } from './context-lists';
import {
  CompletionOptions,
  Transcript,
  type ReplLogPart,
  type ReplLogRow,
} from './live-output';

const LOBBY_POLL_INTERVAL_MS = 2000;
const CLIENT_ID_KEY = 'bunnyland.webRepl.clientId';
const ICON_PREF_KEY = 'bunnyland.webRepl.showIcons';
const META_COMMANDS = [
  'help', 'who', 'look', 'inventory', 'inv', 'points', 'play', 'image', 'img',
  'sheet', 'profile', 'refresh', 'queued', 'cancel', 'clear',
];

interface LiveUpdates {
  close: () => void;
}

interface LiveOptions {
  base: string;
  characterId: string;
  control: ControlClaim | null;
  onState: (state: string) => void;
  refresh: () => void | Promise<void>;
}

interface NarratedLine {
  icon?: string;
  kind?: string;
  text: string;
}

interface ClaimResult {
  active?: boolean;
  character_id?: string;
  claim_id?: string;
  claim_secret?: string;
  controller_generation?: number;
  controller_id?: string;
  generation?: number;
}

interface TargetPrefixResult {
  raw: string;
  remaining: string;
}

export interface WebReplServices {
  actionArguments: (action: ActionView) => ActionArgument[];
  actionAvailable: (action: ActionView) => boolean;
  actionCost: (action: ActionView | QueuedCommand) => { action: number; focus: number };
  actionIcon: (action: ActionView) => string;
  actionLane: (action: ActionView | QueuedCommand) => string;
  actionTitle: (action: ActionView | QueuedCommand) => string;
  actionTool: (action: ActionView) => string;
  actionUnavailableReason: (action: ActionView) => string;
  allTargets: (projection: CharacterProjection | null) => TargetOption[];
  applyConfig: (options: {
    connect: (server: string) => void;
    isConnected: () => boolean;
  }) => Promise<unknown>;
  cancelQueuedCommand: (
    base: string, characterId: string, commandId: string, control: ControlClaim,
  ) => Promise<unknown>;
  characterHref: (base: string, characterId: string) => string;
  claimSettings: () => Record<string, unknown>;
  claimWebController: (
    base: string, payload: Record<string, unknown>, control: ControlClaim | null,
  ) => Promise<ClaimResult>;
  clearClaimControl: (key: string, characterId: string) => void;
  controlFromResponse: (
    data: unknown, characterId: string, options: { active: boolean },
  ) => ControlClaim | null;
  createPlayerLiveUpdates: (options: LiveOptions) => LiveUpdates;
  drainNarratedEvents: (messages: unknown[], options: {
    nameFor: (id: string) => string | null;
    playerId: string;
    roomOf: (id: string) => string | null;
    seenIds: Set<string>;
  }) => { lines: NarratedLine[]; seenIds: Set<string> };
  fetchCharacterList: (base: string) => Promise<{ characters: CharacterSummary[]; epoch: number }>;
  fetchClaimProjection: (
    base: string, characterId: string, control: ControlClaim | null,
  ) => Promise<{ character: CharacterProjection | null; queued: QueuedProjection | null }>;
  fetchCharacterRecentEvents: (
    base: string, characterId: string, control: ControlClaim | null,
  ) => Promise<{ events?: unknown[] }>;
  fetchContentFlags: (base: string) => Promise<unknown>;
  formatPoints: (value: unknown) => string;
  iconPreference: (key: string, fallback: boolean) => boolean;
  imageAffordance: { DELIVER_EMOJI: string; FAIL_EMOJI: string; REQUEST_EMOJI: string };
  imageRequestMessage: (result: unknown) => string;
  initClientMenu: () => { close?: () => void } | void;
  isClaimNotFoundError: (error: unknown) => boolean;
  isReferenceArg: (argument: ActionArgument) => boolean;
  latestImageCompletion: (
    messages: unknown[], options: { base: string; purpose: string },
  ) => { epoch: number; url: string } | null;
  latestImageFailure: (
    messages: unknown[], options: { purpose: string },
  ) => { epoch: number; reason: string } | null;
  normalizeBase: (url: string) => string;
  orderActionsByAvailability: (actions: ActionView[]) => ActionView[];
  persistentClientId: (key: string, prefix: string) => string;
  playerControl: (
    control: ControlClaim | null, projection: CharacterProjection | null, characterId: string,
  ) => ControlClaim | null;
  queuedCountdownSeconds: (projection: QueuedProjection | null) => number | null;
  releaseWebClaim: (
    base: string, payload: Record<string, unknown>, control: ControlClaim,
  ) => Promise<unknown>;
  releaseWebController: (
    base: string, payload: Record<string, unknown>, control: ControlClaim,
  ) => Promise<ClaimResult>;
  requestSceneImage: (
    base: string, characterId: string, control: ControlClaim | null,
  ) => Promise<unknown>;
  resolveTargetName: (value: string, candidates: TargetOption[]) => TargetOption | null;
  serverFromUrl: () => string;
  setIconPreference: (key: string, value: boolean) => void;
  setServerInUrl: (base: string) => void;
  storeClaimControl: (key: string, control: ControlClaim) => void;
  storedClaimControl: (key: string, characterId: string) => ControlClaim | null;
  submitCommand: (
    base: string, payload: Record<string, unknown>, control: ControlClaim,
  ) => Promise<unknown>;
  suggestTargetNames: (value: string, candidates: TargetOption[]) => string[];
  syncClaimControl: (
    control: ControlClaim | null, projection: CharacterProjection | null, characterId: string,
  ) => ControlClaim | null;
  targetCandidates: (projection: CharacterProjection | null, argument: ActionArgument) => TargetOption[];
  targetPrefix: (rest: string, candidates: TargetOption[]) => TargetPrefixResult | null;
  updateWebControllerFallback: (
    base: string, payload: Record<string, unknown>, control: ControlClaim,
  ) => Promise<ClaimResult>;
}

interface WebReplBrowserRuntime extends Window {
  BunnylandApi: {
    applyConfigToInput: WebReplServices['applyConfig'];
    normalizeBase: WebReplServices['normalizeBase'];
    requestSceneImage: WebReplServices['requestSceneImage'];
    sendJson: (base: string, path: string) => Promise<unknown>;
    serverFromUrl: WebReplServices['serverFromUrl'];
    setServerInUrl: WebReplServices['setServerInUrl'];
  };
  BunnylandPlay: Omit<WebReplServices,
    'applyConfig' | 'initClientMenu' | 'normalizeBase' | 'requestSceneImage' | 'serverFromUrl' | 'setServerInUrl'> & {
    IMAGE_AFFORDANCE: WebReplServices['imageAffordance'];
  };
  BunnylandUI: { initClientMenu: WebReplServices['initClientMenu'] };
}

function browserServices(): WebReplServices {
  const browser = window as unknown as WebReplBrowserRuntime;
  const fallbackPlay = {
    IMAGE_AFFORDANCE: { DELIVER_EMOJI: '📸', FAIL_EMOJI: '⚠️', REQUEST_EMOJI: '📷' },
  } as WebReplBrowserRuntime['BunnylandPlay'];
  const { IMAGE_AFFORDANCE, ...play } = browser.BunnylandPlay || fallbackPlay;
  return {
    ...play,
    applyConfig: (options) => browser.BunnylandApi.applyConfigToInput(options),
    fetchContentFlags: (base) => browser.BunnylandApi.sendJson(base, '/public/world'),
    imageAffordance: IMAGE_AFFORDANCE,
    initClientMenu: () => browser.BunnylandUI.initClientMenu(),
    normalizeBase: (url) => browser.BunnylandApi.normalizeBase(url),
    requestSceneImage: (base, id, control) => browser.BunnylandApi.requestSceneImage(base, id, control),
    serverFromUrl: () => browser.BunnylandApi.serverFromUrl(),
    setServerInUrl: (base) => browser.BunnylandApi.setServerInUrl(base),
  };
}

const DEFAULT_BROWSER_SERVICES = browserServices();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function splitArgs(rest: string): Record<string, string> {
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  const args: Record<string, string> = {};
  let current = '';
  for (const token of tokens) {
    if (token.includes('=')) {
      const [key = '', ...parts] = token.split('=');
      if (!key) continue;
      args[key] = parts.join('=');
      current = key;
    } else if (current) {
      args[current] = `${args[current] || ''} ${token}`.trim();
    }
  }
  return args;
}

function focusedEntityFromHash(): string {
  try {
    return decodeURIComponent(location.hash.replace(/^#/, '')).trim();
  } catch {
    return '';
  }
}

function setFocusedEntityInHash(entityId: string): void {
  const url = new URL(location.href);
  url.hash = entityId ? encodeURIComponent(entityId) : '';
  history.replaceState(null, '', url);
}

interface ReplFacade {
  readonly characters: readonly CharacterSummary[];
  readonly control: ControlClaim | null;
  readonly projection: CharacterProjection | null;
  refresh: () => Promise<void>;
}

export interface WebReplPageProps {
  services?: WebReplServices;
}

export function WebReplPage({ services = DEFAULT_BROWSER_SERVICES }: WebReplPageProps) {
  const [apiUrl, setApiUrl] = useState('/api/v1/');
  const [apiBase, setApiBase] = useState('');
  const [connected, setConnected] = useState(false);
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [epoch, setEpoch] = useState(0);
  const [playerId, setPlayerId] = useState('');
  const [focusedEntityId, setFocusedEntityId] = useState(focusedEntityFromHash);
  const [projection, setProjection] = useState<CharacterProjection | null>(null);
  const [queuedCommands, setQueuedCommands] = useState<QueuedCommand[]>([]);
  const [queueProjection, setQueueProjection] = useState<QueuedProjection | null>(null);
  const [control, setControl] = useState<ControlClaim | null>(null);
  const [showActionIcons, setShowActionIcons] = useState(() => services.iconPreference(ICON_PREF_KEY, true));
  const [input, setInput] = useState('');
  const [logs, setLogs] = useState<ReplLogRow[]>([{
    id: 1,
    kind: '',
    value: 'Type help for commands. Connect, then choose a player or use play <name>.',
  }]);
  const [apiStatus, setApiStatus] = useState('○ Offline');
  const [statusKind, setStatusKind] = useState('');
  const aliveRef = useRef(true);
  const apiBaseRef = useRef('');
  const connectedRef = useRef(false);
  const charactersRef = useRef<CharacterSummary[]>([]);
  const playerIdRef = useRef('');
  const projectionRef = useRef<CharacterProjection | null>(null);
  const queueProjectionRef = useRef<QueuedProjection | null>(null);
  const queuedCommandsRef = useRef<QueuedCommand[]>([]);
  const controlRef = useRef<ControlClaim | null>(null);
  const showIconsRef = useRef(showActionIcons);
  const liveStateRef = useRef('fallback');
  const refreshRef = useRef<(options?: { announce?: boolean }) => Promise<void>>(async () => undefined);
  const requestGeneration = useRef(0);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(0);
  const logSequence = useRef(1);
  const seenEventIds = useRef(new Set<string>());
  const eventsPrimed = useRef(false);
  const eventImageUrl = useRef('');
  const eventImageFailureEpoch = useRef<number | null>(null);
  const clientId = useRef(services.persistentClientId(CLIENT_ID_KEY, 'web-repl'));
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { requireAcceptance, warningDialog } = useContentWarningGate(
    services.fetchContentFlags,
  );

  apiBaseRef.current = apiBase;
  connectedRef.current = connected;
  charactersRef.current = characters;
  playerIdRef.current = playerId;
  projectionRef.current = projection;
  queuedCommandsRef.current = queuedCommands;
  queueProjectionRef.current = queueProjection;
  controlRef.current = control;
  showIconsRef.current = showActionIcons;

  const write = useCallback((value: string, kind = ''): void => {
    const row = { id: ++logSequence.current, kind, value };
    setLogs((current) => [...current, row]);
  }, []);

  const writeParts = useCallback((parts: ReplLogPart[], kind = ''): void => {
    const row = { id: ++logSequence.current, kind, parts };
    setLogs((current) => [...current, row]);
  }, []);

  const resolveCharacter = useCallback((nameOrId: string): CharacterSummary | null => {
    const list = charactersRef.current;
    const exact = list.find((character) => character.id === nameOrId);
    if (exact) return exact;
    const query = String(nameOrId || '').trim().toLowerCase();
    if (!query) return null;
    return list.find((character) => character.name.toLowerCase() === query)
      || [...list].sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
        .find((character) => character.name.toLowerCase().startsWith(query))
      || null;
  }, []);

  const allTargets = useCallback(
    () => services.allTargets(projectionRef.current),
    [services],
  );

  const nameFor = useCallback((entityId: string): string | null => {
    if (entityId === playerIdRef.current) {
      return charactersRef.current.find((character) => character.id === entityId)?.name || entityId;
    }
    const target = allTargets().find((item) => item.value === entityId);
    return target?.label || charactersRef.current.find((character) => character.id === entityId)?.name || null;
  }, [allTargets]);

  const drainEvents = useCallback((messages: unknown[], prime: boolean): void => {
    const drained = services.drainNarratedEvents(messages, {
      seenIds: seenEventIds.current,
      playerId: playerIdRef.current,
      roomOf: () => projectionRef.current?.room.id || null,
      nameFor,
    });
    seenEventIds.current = drained.seenIds;
    const image = services.latestImageCompletion(messages, { base: apiBaseRef.current, purpose: 'event' });
    if (image && image.url !== eventImageUrl.current) {
      eventImageUrl.current = image.url;
      if (!prime) writeParts([
        { kind: 'text', value: `${services.imageAffordance.DELIVER_EMOJI} scene image ready: ` },
        { href: image.url, kind: 'link', label: 'view image' },
      ]);
    }
    const failure = services.latestImageFailure(messages, { purpose: 'event' });
    if (failure && failure.epoch !== eventImageFailureEpoch.current) {
      eventImageFailureEpoch.current = failure.epoch;
      if (!prime) write(`${services.imageAffordance.FAIL_EMOJI} image request failed: ${failure.reason}`, 'error');
    }
    if (prime) return;
    for (const line of drained.lines) {
      const prefix = showIconsRef.current && line.icon ? `${line.icon} ` : '';
      write(`${prefix}${line.text}`, line.kind || 'event');
    }
  }, [nameFor, services, write, writeParts]);

  const refreshOnce = useCallback(async ({ announce = false }: { announce?: boolean } = {}): Promise<void> => {
    const base = apiBaseRef.current;
    if (!base) return;
    const generation = ++requestGeneration.current;
    let claimRequest = false;
    try {
      const lobby = await services.fetchCharacterList(base);
      if (!aliveRef.current || generation !== requestGeneration.current) return;
      setCharacters(lobby.characters);
      charactersRef.current = lobby.characters;
      setEpoch(lobby.epoch);
      const selected = playerIdRef.current;
      if (selected && !lobby.characters.some((character) => character.id === selected)) {
        playerIdRef.current = '';
        setPlayerId('');
        setProjection(null);
        projectionRef.current = null;
        setQueuedCommands([]);
        setQueueProjection(null);
        setControl(null);
        controlRef.current = null;
      } else if (selected && controlRef.current) {
        claimRequest = true;
        const bundle = await services.fetchClaimProjection(base, selected, controlRef.current);
        const nextProjection = bundle.character;
        if (!aliveRef.current || generation !== requestGeneration.current || selected !== playerIdRef.current) return;
        const accepted = nextProjection?.characterId === selected ? nextProjection : null;
        setProjection(accepted);
        projectionRef.current = accepted;
        const synced = services.syncClaimControl(controlRef.current, accepted, selected);
        setControl(synced);
        controlRef.current = synced;
        const queued = bundle.queued;
        if (!aliveRef.current || generation !== requestGeneration.current || selected !== playerIdRef.current) return;
        const acceptedQueue = queued?.characterId === selected ? queued : null;
        setQueuedCommands(acceptedQueue?.commands || []);
        queuedCommandsRef.current = acceptedQueue?.commands || [];
        setQueueProjection(acceptedQueue);
        queueProjectionRef.current = acceptedQueue;
        try {
          const recent = await services.fetchCharacterRecentEvents(base, selected, synced);
          if (!aliveRef.current || generation !== requestGeneration.current) return;
          drainEvents(recent.events || [], !eventsPrimed.current);
          eventsPrimed.current = true;
        } catch (error) {
          console.warn('Could not refresh Bunnyland web REPL events', error);
        }
      }
      if (!playerIdRef.current || (controlRef.current && liveStateRef.current === 'live')) {
        setStatusKind('live');
        setApiStatus(`● Live · epoch ${lobby.epoch}s`);
      }
      if (announce) write('Connected.', 'ok');
    } catch (error) {
      if (!aliveRef.current || generation !== requestGeneration.current) return;
      const selected = playerIdRef.current;
      if (claimRequest && selected && services.isClaimNotFoundError(error)) {
        services.clearClaimControl(CLIENT_ID_KEY, selected);
        projectionRef.current = null;
        queueProjectionRef.current = null;
        queuedCommandsRef.current = [];
        controlRef.current = null;
        setProjection(null);
        setQueuedCommands([]);
        setQueueProjection(null);
        setControl(null);
        setStatusKind('error');
        setApiStatus('⚠ Claim expired. Claim again to continue.');
        return;
      }
      setStatusKind('error');
      setApiStatus(`⚠ ${errorMessage(error)}`);
      if (announce) write(`Connection failed: ${errorMessage(error)}`, 'error');
    }
  }, [drainEvents, services, write]);
  const refresh = useCallback((options: { announce?: boolean } = {}): Promise<void> => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const request = refreshOnce(options);
    refreshPromiseRef.current = request;
    const clear = (): void => {
      if (refreshPromiseRef.current === request) refreshPromiseRef.current = null;
    };
    void request.then(clear, clear);
    return request;
  }, [refreshOnce]);
  refreshRef.current = refresh;

  const claimPlayer = useCallback(async (): Promise<ControlClaim | null> => {
    const base = apiBaseRef.current;
    const selected = playerIdRef.current;
    if (!base || !selected) return null;
    try {
      if (!await requireAcceptance(base)) return null;
      const stored = services.storedClaimControl(CLIENT_ID_KEY, selected);
      const data = await services.claimWebController(base, {
        ...services.claimSettings(),
        character_id: selected,
        client_id: clientId.current,
        ...(stored?.claimId ? { claim_id: stored.claimId } : {}),
        label: 'web-repl',
      }, stored);
      if (!aliveRef.current || selected !== playerIdRef.current) return null;
      const next = services.controlFromResponse(data, selected, { active: true });
      if (next) services.storeClaimControl(CLIENT_ID_KEY, next);
      setControl(next);
      controlRef.current = next;
      return next;
    } catch (error) {
      console.warn('Could not claim Bunnyland web REPL controller', error);
      return null;
    }
  }, [requireAcceptance, services]);

  const dropPlayer = useCallback((syncHash = true): void => {
    requestGeneration.current += 1;
    refreshPromiseRef.current = null;
    playerIdRef.current = '';
    projectionRef.current = null;
    queueProjectionRef.current = null;
    queuedCommandsRef.current = [];
    controlRef.current = null;
    setPlayerId('');
    setProjection(null);
    setQueuedCommands([]);
    setQueueProjection(null);
    setControl(null);
    seenEventIds.current = new Set();
    eventsPrimed.current = false;
    if (syncHash) {
      setFocusedEntityId('');
      setFocusedEntityInHash('');
    }
  }, []);

  const selectPlayer = useCallback(async (nameOrId: string): Promise<void> => {
    if (!connectedRef.current) {
      write('Connect to a server first.', 'error');
      return;
    }
    const chosen = resolveCharacter(nameOrId);
    if (!chosen) {
      write(`No such player: ${nameOrId}. Try who.`, 'error');
      return;
    }
    requestGeneration.current += 1;
    playerIdRef.current = chosen.id;
    setPlayerId(chosen.id);
    setFocusedEntityId(chosen.id);
    setFocusedEntityInHash(chosen.id);
    projectionRef.current = null;
    setProjection(null);
    const nextControl = await claimPlayer();
    if (!nextControl) {
      write(`Could not claim ${chosen.name}.`, 'error');
      return;
    }
    await refreshRef.current();
    write(`You are now ${chosen.name}.`, 'ok');
  }, [claimPlayer, resolveCharacter, write]);

  const connect = useCallback((url: string): void => {
    const base = services.normalizeBase(url);
    if (!base) return;
    requestGeneration.current += 1;
    apiBaseRef.current = base;
    connectedRef.current = true;
    setApiUrl(base);
    setApiBase(base);
    setConnected(true);
    dropPlayer(false);
    setCharacters([]);
    charactersRef.current = [];
    setEpoch(0);
    setStatusKind('live');
    setApiStatus('● Connected');
    services.setServerInUrl(base);
    write('Connected.', 'ok');
  }, [dropPlayer, services, write]);

  const disconnect = useCallback((): void => {
    requestGeneration.current += 1;
    apiBaseRef.current = '';
    connectedRef.current = false;
    setApiBase('');
    setConnected(false);
    setCharacters([]);
    charactersRef.current = [];
    dropPlayer(false);
    setStatusKind('');
    setApiStatus('○ Offline');
    services.setServerInUrl('');
  }, [dropPlayer, services]);

  const controlSubscriptionKey = control
    ? [control.claimId, control.controllerId, control.generation].join(':')
    : '';

  useEffect(() => {
    if (!connected || !apiBase) return;
    if (!playerId || !controlSubscriptionKey) {
      void refreshRef.current();
      const timer = window.setInterval(() => { void refreshRef.current(); }, LOBBY_POLL_INTERVAL_MS);
      return () => window.clearInterval(timer);
    }
    const live = services.createPlayerLiveUpdates({
      base: apiBase,
      characterId: playerId,
      control: controlRef.current,
      refresh: () => refreshRef.current(),
      onState: (state) => {
        if (!aliveRef.current) return;
        liveStateRef.current = state;
        if (state === 'live') {
          setStatusKind('live');
          setApiStatus('● Live');
        } else if (state !== 'closed') {
          setStatusKind('error');
          setApiStatus('◌ Reconnecting · polling');
        }
      },
    });
    return () => live.close();
  }, [apiBase, connected, controlSubscriptionKey, playerId, services]);

  useEffect(() => {
    aliveRef.current = true;
    const menu = services.initClientMenu();
    const onHashChange = (): void => setFocusedEntityId(focusedEntityFromHash());
    window.addEventListener('hashchange', onHashChange);
    const server = services.serverFromUrl();
    if (server) {
      setApiUrl(server);
      connect(server);
    }
    void services.applyConfig({
      connect,
      isConnected: () => connectedRef.current,
    }).then((config) => {
      if (!aliveRef.current || connectedRef.current || !config || typeof config !== 'object') return;
      const serverUrl = 'serverUrl' in config ? config.serverUrl : '';
      if (typeof serverUrl === 'string' && serverUrl) setApiUrl(serverUrl);
    });
    return () => {
      aliveRef.current = false;
      requestGeneration.current += 1;
      window.removeEventListener('hashchange', onHashChange);
      menu?.close?.();
    };
  }, [connect, services]);

  useEffect(() => {
    if (!connected) return;
    if (!focusedEntityId) {
      if (playerId) dropPlayer(false);
      return;
    }
    if (playerId !== focusedEntityId && characters.some((character) => character.id === focusedEntityId)) {
      void selectPlayer(focusedEntityId);
    }
  }, [characters, connected, dropPlayer, focusedEntityId, playerId, selectPlayer]);

  useSecondBoundaryTick(() => {
      const countdown = services.queuedCountdownSeconds(queueProjectionRef.current);
      if (countdown == null) return;
      setLogs((rows) => rows.map((row) => row.parts ? {
        ...row,
        parts: row.parts.map((part) => part.kind === 'countdown' ? { ...part, value: countdown } : part),
      } : row));
  }, services);

  useEffect(() => {
    const last = logRef.current?.lastElementChild as HTMLElement | null;
    last?.scrollIntoView?.({ block: 'end' });
  }, [logs]);

  useEffect(() => {
    const compatWindow = window as unknown as { app?: ReplFacade };
    const facade: ReplFacade = {
      get characters() { return charactersRef.current; },
      get control() { return controlRef.current; },
      get projection() { return projectionRef.current; },
      refresh: () => refreshRef.current(),
    };
    compatWindow.app = facade;
    return () => {
      if (compatWindow.app === facade) delete compatWindow.app;
    };
  }, []);

  const playerControl = (): ControlClaim | null => (
    services.playerControl(controlRef.current, projectionRef.current, playerIdRef.current)
  );

  const actions = useCallback((): ActionView[] => projectionRef.current?.actions || [], []);
  const actionByName = useCallback((name: string): ActionView | undefined => actions().find((action) => (
    services.actionTool(action) === name || action.command_type === name || action.title === name
  )), [actions, services]);
  const candidatesFor = useCallback((argument: ActionArgument): TargetOption[] => (
    services.targetCandidates(projectionRef.current, argument)
  ), [services]);

  const resolvePayload = (action: ActionView, rawArgs: Record<string, string>): {
    error?: string;
    value?: Record<string, string>;
  } => {
    const out: Record<string, string> = {};
    for (const argument of services.actionArguments(action)) {
      if (!argument.key) continue;
      const raw = rawArgs[argument.key];
      if ((raw == null || raw === '') && argument.required) {
        return { error: `${argument.title || argument.key} is required.` };
      }
      if (raw == null || raw === '') continue;
      if (services.isReferenceArg(argument)) {
        const candidates = candidatesFor(argument);
        const resolved = services.resolveTargetName(raw, candidates);
        if (!resolved) {
          const hints = services.suggestTargetNames(raw, candidates);
          const suffix = hints.length ? ` Did you mean: ${hints.join(', ')}?` : '';
          return {
            error: `I don't see '${raw}' (${argument.key.replace(/_id$/, '').replaceAll('_', ' ')}) here.${suffix}`,
          };
        }
        out[argument.key] = resolved.value;
      } else {
        out[argument.key] = raw;
      }
    }
    for (const [key, value] of Object.entries(rawArgs)) {
      if (!(key in out) && !services.actionArguments(action).some((argument) => argument.key === key)) out[key] = value;
    }
    return { value: out };
  };

  const parseAction = (line: string): { arguments: Record<string, string>; tool: string } | null => {
    const [command = '', ...restParts] = line.trim().split(/\s+/);
    const rest = restParts.join(' ');
    if (command === 'go') {
      const action = actionByName('move');
      if (!action || !rest) return null;
      const args = services.actionArguments(action);
      const key = args.find((argument) => argument.key === 'direction')?.key
        || args.find((argument) => argument.target_group === 'exits')?.key
        || args.find((argument) => argument.kind === 'entity')?.key
        || 'direction';
      return { arguments: { [key]: rest }, tool: services.actionTool(action) };
    }
    const action = actionByName(command);
    if (!action) return null;
    if (!rest) return { arguments: {}, tool: services.actionTool(action) };
    if (/\S+=/.test(rest)) return { arguments: splitArgs(rest), tool: services.actionTool(action) };
    const args = services.actionArguments(action).filter((argument) => argument.key);
    const required = args.filter((argument) => argument.required);
    const fields = required.length ? required : args;
    const only = fields[0];
    if (fields.length === 1 && only) return { arguments: { [only.key]: rest }, tool: services.actionTool(action) };
    const entityArg = fields.find((argument) => services.isReferenceArg(argument));
    const textArg = fields.find((argument) => !services.isReferenceArg(argument) && (argument.kind || 'string') === 'string');
    if (entityArg && textArg) {
      const match = services.targetPrefix(rest, candidatesFor(entityArg));
      if (match) return {
        arguments: { [entityArg.key]: match.raw, [textArg.key]: match.remaining },
        tool: services.actionTool(action),
      };
    }
    return null;
  };

  const claimButtonLabel = !playerId || !control ? 'Claim' : control.active === false ? 'Resume' : 'Idle';

  const updateClaimFallback = async (): Promise<void> => {
    const current = controlRef.current;
    if (!apiBaseRef.current || !playerIdRef.current || !current) return;
    try {
      const data = await services.updateWebControllerFallback(apiBaseRef.current, {
        ...services.claimSettings(), character_id: playerIdRef.current,
        claim_id: current.claimId, client_id: clientId.current,
      }, current);
      const next = services.controlFromResponse(data, playerIdRef.current, { active: current.active !== false });
      if (next) services.storeClaimControl(CLIENT_ID_KEY, next);
      setControl(next);
      controlRef.current = next;
    } catch (error) {
      console.warn('Could not update Bunnyland web REPL fallback', error);
    }
  };

  const releaseController = async (): Promise<void> => {
    const current = controlRef.current;
    if (!apiBaseRef.current || !playerIdRef.current || !current) return;
    try {
      const data = await services.releaseWebController(apiBaseRef.current, {
        ...services.claimSettings(), character_id: playerIdRef.current,
        claim_id: current.claimId, client_id: clientId.current,
      }, current);
      const next = services.controlFromResponse(data, playerIdRef.current, { active: false });
      if (next) services.storeClaimControl(CLIENT_ID_KEY, next);
      setControl(next);
      controlRef.current = next;
      await refreshRef.current();
      write('Character is idle.', 'system');
    } catch (error) {
      write(`Could not release control: ${errorMessage(error)}`, 'error');
    }
  };

  const releaseClaim = async (): Promise<void> => {
    const selected = playerIdRef.current;
    const current = controlRef.current;
    if (!apiBaseRef.current || !selected || !current) return;
    try {
      await services.releaseWebClaim(apiBaseRef.current, {
        character_id: selected, claim_id: current.claimId, client_id: clientId.current,
      }, current);
      services.clearClaimControl(CLIENT_ID_KEY, selected);
      dialogRef.current?.close();
      dropPlayer();
      write('Released claim.', 'system');
    } catch (error) {
      write(`Could not release claim: ${errorMessage(error)}`, 'error');
    }
  };

  const requestImage = async (): Promise<void> => {
    if (!apiBaseRef.current || !playerIdRef.current) {
      write('Pick a player first: play <name>.', 'error');
      return;
    }
    try {
      const result = await services.requestSceneImage(apiBaseRef.current, playerIdRef.current, controlRef.current);
      write(services.imageRequestMessage(result), 'ok');
    } catch (error) {
      write(`${services.imageAffordance.REQUEST_EMOJI} ${errorMessage(error)}`, 'error');
    }
  };

  const sheetTarget = (name: string): string => {
    const query = name.trim();
    if (!query) return playerIdRef.current;
    if (['me', 'self', 'player', 'current', 'you'].includes(query.toLowerCase())) return playerIdRef.current;
    const lobby = resolveCharacter(query);
    if (lobby) return lobby.id;
    return services.resolveTargetName(
      query, allTargets().filter((target) => target.kind === 'character'),
    )?.value || '';
  };

  const openSheet = (name: string): void => {
    if (!apiBaseRef.current || !playerIdRef.current) {
      write(apiBaseRef.current ? 'Pick a player first: play <name>.' : 'Connect to a server first.', 'error');
      return;
    }
    const characterId = sheetTarget(name);
    if (!characterId) {
      write(`No character sheet target: ${name}. Try who.`, 'error');
      return;
    }
    const href = services.characterHref(apiBaseRef.current, characterId);
    const opened = window.open(href, '_blank', 'noopener');
    write(opened ? `Opened sheet: ${href}` : `Sheet URL: ${href}`, 'ok');
  };

  const writeEntityList = (items: Array<{ insert: string; label: string; suffix?: string }>): void => {
    const parts: ReplLogPart[] = [];
    items.forEach((item, index) => {
      if (index) parts.push({ kind: 'break' });
      parts.push({ insert: item.insert, kind: 'entity', label: item.label });
      if (item.suffix) parts.push({ kind: 'text', value: item.suffix });
    });
    writeParts(parts);
  };

  const act = async (line: string): Promise<void> => {
    const parsed = parseAction(line);
    if (!parsed) {
      write(`I don't understand '${line.split(/\s+/, 1)[0]}'. Type help.`, 'error');
      return;
    }
    if (!playerIdRef.current) {
      write('Pick a player first: play <name>.', 'error');
      return;
    }
    const action = actionByName(parsed.tool);
    if (!action) {
      write(`I don't understand '${parsed.tool}'. Type help.`, 'error');
      return;
    }
    const payload = resolvePayload(action, parsed.arguments);
    if (payload.error || !payload.value) {
      write(payload.error || 'Invalid command.', 'error');
      return;
    }
    const activeControl = playerControl() || await claimPlayer();
    if (!activeControl) {
      write('Could not claim a web controller for this player.', 'error');
      return;
    }
    const cost = services.actionCost(action);
    try {
      const result = await services.submitCommand(apiBaseRef.current, {
        character_id: playerIdRef.current,
        claim_id: activeControl.claimId,
        command_type: action.command_type || services.actionTool(action),
        controller_generation: activeControl.generation,
        controller_id: activeControl.controllerId,
        cost: { action: cost.action, focus: cost.focus },
        lane: services.actionLane(action),
        on_insufficient_points: 'queue',
        payload: payload.value,
      }, activeControl) as { queued?: boolean; reason?: string };
      if (result?.queued === false) {
        write(result.reason || 'Command rejected.', 'error');
        await refreshRef.current();
        return;
      }
      const detail = Object.entries(payload.value).map(([key, value]) => `${key}=${value}`).join(' ');
      write(`» ${action.command_type || services.actionTool(action)}${detail ? ` ${detail}` : ''}`, 'ok');
      await refreshRef.current();
    } catch (error) {
      write(`Command failed: ${errorMessage(error)}`, 'error');
    }
  };

  const dispatch = async (line: string): Promise<void> => {
    const [verb = '', ...restParts] = line.trim().split(/\s+/);
    const rest = restParts.join(' ');
    if (verb === 'help') {
      const action = rest ? actionByName(rest) : null;
      if (action) {
        const keys = services.actionArguments(action).map((argument) => argument.key).filter(Boolean).join(', ') || '(none)';
        write(`${services.actionTool(action)} - ${services.actionTitle(action)}\n  parameters: ${keys}`);
      } else {
        const commands = actions().map(services.actionTool).sort().join(', ') || '(load a player first)';
        write(`Commands: ${commands}\nMeta: ${META_COMMANDS.join(', ')}\nForms: move direction=north, take item_id=a brass key, go north, take brass key, say hello.`);
      }
      return;
    }
    if (verb === 'who') {
      if (!charactersRef.current.length) write('No players.');
      else writeEntityList(charactersRef.current.map((character) => ({
        insert: character.name,
        label: character.name,
        suffix: character.id === playerIdRef.current ? ' (you)' : '',
      })));
      return;
    }
    if (verb === 'look') {
      const room = projectionRef.current?.room;
      if (!room?.id) write('No room.');
      else {
        const parts: ReplLogPart[] = [{ kind: 'strong', value: room.title || room.id }];
        const description = String(
          (room as CharacterProjection['room'] & { description?: string }).description || '',
        );
        if (description) parts.push({ kind: 'break' }, { kind: 'text', value: description });
        for (const entity of room.entities as Array<Record<string, unknown>>) {
          const label = String(entity.name || entity.id || '');
          parts.push({ kind: 'break' }, { kind: 'text', value: '  ' }, {
            insert: label, kind: 'entity', label,
          });
          if (entity.id === playerIdRef.current) parts.push({ kind: 'text', value: ' (you)' });
        }
        if (room.exits.length) {
          parts.push({ kind: 'break' }, { kind: 'text', value: '  exits: ' });
          room.exits.forEach((exit, index) => {
            if (index) parts.push({ kind: 'text', value: ', ' });
            const label = exit.direction ? `${exit.direction} -> ${exit.label || exit.id}` : exit.label || exit.id;
            parts.push({ insert: exit.direction || exit.label || exit.id, kind: 'entity', label });
          });
        }
        writeParts(parts);
      }
      return;
    }
    if (verb === 'inventory' || verb === 'inv') {
      const inventory = projectionRef.current?.inventory || [];
      if (!playerIdRef.current) write('Pick a player first: play <name>.', 'error');
      else if (!inventory.length) write("You aren't carrying anything.");
      else writeEntityList(inventory.map((item) => {
        const label = item.label || item.name || item.id;
        return { insert: label, label: `  ${label}`, suffix: item.kind ? ` (${item.kind})` : '' };
      }));
      return;
    }
    if (verb === 'points') {
      if (!playerIdRef.current) write('Pick a player first: play <name>.', 'error');
      else {
        const points = projectionRef.current?.points || {};
        write(`AP ${services.formatPoints(points.action)}/${services.formatPoints(points.action_max)}   FP ${services.formatPoints(points.focus)}/${services.formatPoints(points.focus_max)}`);
      }
      return;
    }
    if (verb === 'queued') {
      if (!playerIdRef.current) write('Pick a player first: play <name>.', 'error');
      else if (!queuedCommandsRef.current.length) write('No queued actions.');
      else {
        const countdown = services.queuedCountdownSeconds(queueProjectionRef.current);
        if (countdown != null) writeParts([
          { kind: 'text', value: 'Next tick in ' }, { kind: 'countdown', value: countdown },
          { kind: 'text', value: 's.' },
        ]);
        write(queuedCommandsRef.current.map((command) => {
          const payload = Object.entries(command.payload || {}).map(([key, value]) => `${key}=${value}`).join(' ');
          return `${command.command_id}: ${command.command_type}${payload ? ` ${payload}` : ''}`;
        }).join('\n'));
      }
      return;
    }
    if (verb === 'cancel') {
      if (!playerIdRef.current) write('Pick a player first: play <name>.', 'error');
      else if (!rest) write('Usage: cancel <command id>', 'error');
      else {
        const activeControl = playerControl() || await claimPlayer();
        if (!activeControl) write('Could not claim a web controller for this player.', 'error');
        else try {
          const result = await services.cancelQueuedCommand(
            apiBaseRef.current, playerIdRef.current, rest, activeControl,
          ) as { cancelled?: boolean; reason?: string };
          write(result.cancelled ? `Cancelled ${rest}.` : result.reason || 'Command was not cancelled.', result.cancelled ? 'ok' : 'error');
          await refreshRef.current();
        } catch (error) {
          write(`Cancel failed: ${errorMessage(error)}`, 'error');
        }
      }
      return;
    }
    if (verb === 'refresh') {
      await refreshRef.current();
      write('Refreshed.', 'ok');
      return;
    }
    if (verb === 'clear') {
      setLogs([]);
      return;
    }
    if (verb === 'play') {
      if (!rest) write('Usage: play <player name>', 'error');
      else await selectPlayer(rest);
      return;
    }
    if (verb === 'image' || verb === 'img') {
      await requestImage();
      return;
    }
    if (verb === 'sheet' || verb === 'profile') {
      openSheet(rest);
      return;
    }
    await act(line);
  };

  const dispatchInput = async (): Promise<void> => {
    const line = input.trim();
    if (!line) return;
    setInput('');
    historyRef.current.push(line);
    historyIndexRef.current = historyRef.current.length;
    write(`> ${line}`, 'command');
    await dispatch(line);
  };

  const completionOptions = useCallback((line: string): string[] => {
    const words = [...META_COMMANDS, ...actions().map(services.actionTool)];
    if (!line.includes(' ')) return [...new Set(words)].sort().filter((word) => word.startsWith(line));
    const [command = '', ...restParts] = line.split(/\s+/);
    const rest = restParts.join(' ');
    if (command === 'help') return actions().map(services.actionTool).filter((word) => word.startsWith(rest)).map((word) => `help ${word}`);
    if (command === 'play') return charactersRef.current.map((character) => character.name).filter((name) => name.startsWith(rest)).map((name) => `play ${name}`);
    const action = actionByName(command);
    if (!action) return [];
    const current = line.split(/\s+/).at(-1) || '';
    if (current.includes('=')) {
      const [key = '', prefix = ''] = current.split('=');
      const argument = services.actionArguments(action).find((item) => item.key === key);
      const base = line.slice(0, line.length - current.length) + `${key}=`;
      if (argument && services.isReferenceArg(argument)) {
        return candidatesFor(argument).map((item) => item.label).filter((label) => label.startsWith(prefix)).map((label) => base + label);
      }
      if (argument?.kind === 'boolean') return ['false', 'true'].filter((value) => value.startsWith(prefix)).map((value) => base + value);
    }
    const base = line.slice(0, line.length - current.length);
    return services.actionArguments(action).map((argument) => argument.key)
      .filter((key) => key && key.startsWith(current)).map((key) => `${base}${key}=`);
  }, [actionByName, actions, candidatesFor, services]);

  const completions = useMemo(() => completionOptions(input).slice(0, 12), [completionOptions, input]);
  const sortedCharacters = useMemo(() => [...characters].sort((a, b) => a.name.localeCompare(b.name)), [characters]);
  const player = characters.find((character) => character.id === playerId);
  const points = projection?.points || {};
  const actionRows: ReplActionRow[] = services.orderActionsByAvailability(projection?.actions || []).map((action) => {
    const cost = services.actionCost(action);
    const parts = [];
    if (cost.action) parts.push(`${cost.action} AP`);
    if (cost.focus) parts.push(`${cost.focus} FP`);
    const reason = services.actionUnavailableReason(action);
    return {
      available: services.actionAvailable(action),
      icon: showActionIcons ? services.actionIcon(action) : '',
      key: `${services.actionLane(action)}:${services.actionTool(action)}`,
      label: services.actionTool(action),
      meta: [parts.join(' + ') || 'free', reason].filter(Boolean).join(' - '),
      reason,
    };
  });
  const targetRows: ReplTargetRow[] = services.allTargets(projection).slice(0, 24).map((target) => ({
    key: target.value, kind: target.kind || target.value, label: target.label,
  }));

  return <>
    <Toolbar id="toolbar">
      <ToolbarRow class="toolbar-heading" id="toolbar-row1">
        <ToolbarBrand icon={<img src="favicon.png" alt="" />}>Bunnyland Web REPL</ToolbarBrand>
        <Button id="btn-client-menu" class="client-menu-button">Menu</Button>
      </ToolbarRow>
      <ToolbarRow id="toolbar-row2">
        <label for="api-url">Server:</label>
        <input id="api-url" onInput={(event): void => setApiUrl(event.currentTarget.value)} spellcheck={false} type="text" value={apiUrl} />
        <Button id="btn-connect" onClick={(): void => {
          if (connected) disconnect(); else connect(apiUrl.trim());
        }}>{connected ? 'Disconnect' : 'Connect Live'}</Button>
        <StatusText class={statusKind} id="api-status" tone={statusKind === 'live' ? 'ok' : statusKind === 'error' ? 'error' : 'muted'}>{apiStatus}</StatusText>
      </ToolbarRow>
      <ToolbarRow id="toolbar-row3">
        <label for="player-select">Character:</label>
        <select id="player-select" onChange={(event): void => {
          if (event.currentTarget.value) void selectPlayer(event.currentTarget.value); else dropPlayer();
        }} value={sortedCharacters.some((character) => character.id === playerId) ? playerId : ''}>
          <option value="">— select to play —</option>
          {sortedCharacters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
        </select>
        <Button disabled={!playerId} id="btn-claim-menu" onClick={(): void => {
          if (playerId) dialogRef.current?.showModal();
        }}>{claimButtonLabel}</Button>
        <Button id="btn-request-image" title="Request an image of your character's current scene" onClick={(): void => { void requestImage(); }}>📷 Image</Button>
      </ToolbarRow>
    </Toolbar>

    <dialog id="claim-dialog" ref={dialogRef}>
      <form method="dialog" class="claim-dialog-form">
        <h3>Claim</h3>
        <label for="claim-fallback">Idle controller</label>
        <select id="claim-fallback"><option value="suspend">Suspended</option><option value="llm">LLM</option><option value="controller">Existing controller</option></select>
        <label for="claim-fallback-controller">Idle controller ID</label>
        <input type="text" id="claim-fallback-controller" spellcheck={false} placeholder="entity_..." />
        <label for="claim-timeout">Idle timeout minutes</label>
        <input type="number" id="claim-timeout" min="5" max="60" step="1" value="30" />
        <div class="dialog-actions">
          <Button id="btn-dialog-claim" onClick={(): void => { void claimPlayer(); }}>{control?.active === false ? 'Resume' : 'Claim'}</Button>
          <Button id="btn-dialog-save-fallback" onClick={(): void => { void updateClaimFallback(); }}>Save Idle</Button>
          <Button id="btn-dialog-release-controller" onClick={(): void => { void releaseController(); }}>Idle</Button>
          <Button id="btn-dialog-release-claim" onClick={(): void => { void releaseClaim(); }}>Release</Button>
          <Button type="submit">Close</Button>
        </div>
      </form>
    </dialog>

    <main id="main" class="app-grid">
      <section id="terminal-pane" aria-label="REPL transcript">
        <div id="repl-log" ref={logRef} onClick={(event): void => {
          const button = (event.target as Element).closest<HTMLButtonElement>('.entity-link');
          if (!button?.dataset.insert) return;
          setInput((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${button.dataset.insert}`);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}><Transcript rows={logs} /></div>
        <form id="prompt-row" autocomplete="off" onSubmit={(event): void => { event.preventDefault(); void dispatchInput(); }}>
          <span id="prompt-label">&gt;</span>
          <input
            aria-label="Command"
            id="repl-input"
            list="repl-completions"
            onInput={(event): void => setInput(event.currentTarget.value)}
            onKeyDown={(event): void => {
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (historyIndexRef.current > 0) historyIndexRef.current -= 1;
                setInput(historyRef.current[historyIndexRef.current] || '');
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (historyIndexRef.current < historyRef.current.length) historyIndexRef.current += 1;
                setInput(historyRef.current[historyIndexRef.current] || '');
              } else if (event.key === 'Tab' && completions.length === 1) {
                event.preventDefault();
                setInput(completions[0] || '');
              }
            }}
            ref={inputRef}
            spellcheck={false}
            type="text"
            value={input}
          />
          <datalist id="repl-completions"><CompletionOptions values={completions} /></datalist>
          <Button id="btn-send" type="submit">Send</Button>
        </form>
      </section>
      <aside id="side-pane" aria-label="Current context">
        <div class="side-section"><div class="side-title">Status</div><div id="side-status" class={player ? 'side-list' : 'side-empty'}>
          {player ? <>
            <div class="side-row"><strong>{player.name}</strong><span>epoch {epoch}s</span></div>
            <div class="side-row"><strong>AP {services.formatPoints(points.action)}/{services.formatPoints(points.action_max)}</strong><span>FP {services.formatPoints(points.focus)}/{services.formatPoints(points.focus_max)}</span></div>
          </> : connected ? 'Pick a player.' : 'Connect to a running server.'}
        </div></div>
        <div class="side-section"><div class="side-title">Actions</div>
          <label class="icon-toggle" title="Show action and event icons"><input id="show-action-icons" type="checkbox" checked={showActionIcons} onChange={(event): void => {
            const value = event.currentTarget.checked; setShowActionIcons(value); services.setIconPreference(ICON_PREF_KEY, value);
          }} /> Icons</label>
          <div id="side-actions" class={actionRows.length ? 'side-list' : 'side-empty'}><ActionRows actions={actionRows} /></div>
        </div>
        <div class="side-section"><div class="side-title">Targets</div><div id="side-targets" class={targetRows.length ? 'side-list' : 'side-empty'}><TargetRows targets={targetRows} /></div></div>
        <div class="side-section"><div class="side-title">Quick Commands</div><div>
          {['help', 'who', 'play <name>', 'look', 'inventory', 'points', 'image', 'sheet', 'queued'].map((command) => <span class="help-chip" key={command}>{command}</span>)}
        </div></div>
      </aside>
    </main>
    {warningDialog}
  </>;
}

const root = document.getElementById('app');
if (root) render(<AuthProvider base={serverFromUrl() || '/api/v1'}><AuthGate scopes={['world:play']}><WebReplPage /></AuthGate></AuthProvider>, root);
