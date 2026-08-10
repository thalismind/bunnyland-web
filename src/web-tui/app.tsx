import { serverFromUrl } from '@bunnyland/ui-web/api';
import { AuthGate, AuthProvider } from '@bunnyland/ui-web/preact';
import { render } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { useContentWarningGate } from '../content-warning';
import {
  fetchGenerationFeatures,
  latestVideoCompletion,
  latestVideoFailure,
  requestSceneVideo,
  VIDEO_AFFORDANCE,
  videoRequestMessage,
} from '../media-generation';
import { ActionSections, ActivityRows, LiveQueuedRows, type TuiActivityRow, type TuiActionRow } from './live-projections';
import { ExitList, InventoryList, MemberList } from './world-lists';

type JsonObject = Record<string, unknown> & {
  command_id?: string;
  direction?: string;
  icon?: string;
  id?: string;
  kind?: string;
  label?: string;
  locked?: boolean;
  name?: string;
  title?: string;
};
type Control = { active?: boolean; claimId?: string; controllerId?: string; generation?: number } & JsonObject;
type Character = { id: string; kind?: string; name: string };
type ActionArgument = JsonObject & { key: string; kind?: string; required?: boolean; target_group?: string; title?: string };
type Action = JsonObject & {
  arguments?: ActionArgument[];
  available?: boolean;
  command_type?: string;
  cost?: { action?: number; focus?: number };
  lane?: string;
  title?: string;
  tool_name?: string;
  unavailable_reason?: string;
};
type Projection = JsonObject & {
  actions?: Action[]; characterId?: string; inventory?: JsonObject[]; points?: JsonObject;
  room?: JsonObject & { entities?: JsonObject[]; exits?: JsonObject[] }; targetGroups?: Record<string, JsonObject[]>;
  worldEpoch?: number;
};
type QueueProjection = JsonObject & { characterId?: string; commands?: JsonObject[] };
type Model = {
  activity: (JsonObject & { key: string; kind?: string; text: string })[];
  characters: Character[];
  connected: boolean;
  control: Control | null;
  eventsPrimed: boolean;
  features: { imageGeneration: boolean; videoGeneration: boolean };
  playerId: string;
  projection: Projection | null;
  queueProjection: QueueProjection | null;
  queued: JsonObject[];
  selectedId: string;
  seenEventIds: Set<string>;
  status: { kind: string; text: string };
};

interface WebTuiPlayRuntime {
  IMAGE_AFFORDANCE: { DELIVER_EMOJI: string; FAIL_EMOJI: string; REQUEST_EMOJI: string };
  actionArguments(action: Action): ActionArgument[];
  actionAvailable(action: Action, options?: { fallback?: boolean }): boolean;
  actionCommandType(action: Action): string;
  actionCost(action: Action): { action: number; focus: number };
  actionFields(action: Action, targets: (group: string) => JsonObject[]): FormField[];
  actionIcon(action: Action): string;
  actionLane(action: Action): 'focus' | 'world';
  actionTitle(action: Action): string;
  actionTool(action: Action): string;
  actionUnavailableReason(action: Action): string;
  allTargets(projection: Projection | null): Array<JsonObject & { label: string; value: string }>;
  cancelQueuedCommand(base: string, characterId: string, commandId: string, control: Control | null): Promise<unknown>;
  characterHref(base: string, characterId: string): string;
  claimSettings(): JsonObject;
  claimWebController(base: string, payload: JsonObject, control: Control | null): Promise<JsonObject>;
  clearClaimControl(key: string, characterId: string): void;
  controlFromResponse(data: JsonObject, characterId: string, options: { active: boolean }): Control;
  createPlayerLiveUpdates(options: Record<string, unknown>): { close(): void };
  drainNarratedEvents(messages: unknown[], options: Record<string, unknown>): { lines: Array<JsonObject & { text: string }>; seenIds: Set<string> };
  entityIcon(entity: JsonObject): string;
  fetchCharacterList(base: string): Promise<{ characters: Character[]; epoch: number }>;
  fetchCharacterRecentEvents(base: string, characterId: string, control: Control | null): Promise<{ events?: JsonObject[] }>;
  fetchClaimProjection(base: string, characterId: string, control: Control | null): Promise<{ character: Projection | null; queued: QueueProjection | null }>;
  filterActions(actions: Action[], filter: string): Action[];
  formatPoints(value: unknown): string;
  iconPreference(key: string, fallback: boolean): boolean;
  imageRequestMessage(result: unknown): string;
  inventoryEntries(projection: Projection | null): Array<JsonObject & { icon: string; id: string; kind: string; label: string }>;
  isClaimNotFoundError(error: unknown): boolean;
  latestImageCompletion(messages: unknown[], options: Record<string, unknown>): { url?: string } | null;
  latestImageFailure(messages: unknown[], options: Record<string, unknown>): { epoch?: number; reason?: string } | null;
  persistentClientId(key: string, prefix: string): string;
  queuedCommandLabel(command: JsonObject, actions: Action[]): string;
  queuedCountdownSeconds(projection: QueueProjection | null): number | null;
  releaseWebClaim(base: string, payload: JsonObject, control: Control | null): Promise<unknown>;
  releaseWebController(base: string, payload: JsonObject, control: Control | null): Promise<JsonObject>;
  setIconPreference(key: string, value: boolean): void;
  storeClaimControl(key: string, control: Control): void;
  storedClaimControl(key: string, characterId: string): Control | null;
  submitCommand(base: string, payload: JsonObject, control: Control): Promise<JsonObject & { queued?: boolean; reason?: string }>;
  syncClaimControl(control: Control | null, projection: Projection | null, characterId: string): Control | null;
  updateWebControllerFallback(base: string, payload: JsonObject, control: Control | null): Promise<JsonObject>;
}

interface WebTuiApiRuntime {
  applyConfigToInput(options: Record<string, unknown>): Promise<unknown>;
  applyServerParam(options: Record<string, unknown>): void;
  claimHeaders(control: Control | null): Record<string, string>;
  mediaUrl(base: string, path: unknown): string;
  normalizeBase(value: string): string;
  requestSceneImage(base: string, characterId: string, control: Control | null): Promise<unknown>;
  fetchFeatures?(base: string): Promise<{ image_generation?: boolean; video_generation?: boolean }>;
  sendJson(base: string, path: string, init?: RequestInit): Promise<unknown>;
  setServerInUrl(base: string): void;
}

const globals = globalThis as typeof globalThis & {
  BunnylandApi: WebTuiApiRuntime;
  BunnylandPlay: WebTuiPlayRuntime;
  BunnylandUI: {
    initClientMenu(): { close?: () => void } | void;
    initHelp(options: { intro: string; sections: unknown[]; title: string }): void;
  };
};
const play = globals.BunnylandPlay;
const api = globals.BunnylandApi;
const CLIENT_ID_KEY = 'bunnyland.webTui.clientId';
const ICON_PREF_KEY = 'bunnyland.webTui.showIcons';
const UNAVAILABLE_PREF_KEY = 'bunnyland.webTui.showUnavailable';
const ACTIVITY_LIMIT = 8;

function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
function targetFromHash() {
  try { return decodeURIComponent(window.location.hash.replace(/^#/, '')).trim(); }
  catch { return ''; }
}

interface FormField {
  candidates?: { icon?: string; label: string; value: string }[];
  key: string;
  kind: string;
  label: string;
  required: boolean;
}

interface FormState { action: Action; error: string; fields: FormField[]; values: Record<string, string> }

type WebTuiFacade = {
  readonly characters: Character[];
  readonly control: Control | null;
  readonly projection: Projection | null;
  refresh(): Promise<void>;
};
const pageWindow = window as unknown as Window & { app?: WebTuiFacade };

export function WebTuiPage() {
  const initial: Model = {
    activity: [], characters: [], connected: false, control: null, eventsPrimed: false,
    features: { imageGeneration: false, videoGeneration: false },
    playerId: '', projection: null, queued: [], queueProjection: null, selectedId: '',
    seenEventIds: new Set(), status: { kind: '', text: '○ Offline' },
  };
  const [model, setModelState] = useState(initial);
  const modelRef = useRef(initial);
  const baseRef = useRef('');
  const [filter, setFilter] = useState('');
  const [showIcons, setShowIcons] = useState(() => Boolean(play.iconPreference(ICON_PREF_KEY, true)));
  const [showUnavailable, setShowUnavailable] = useState(() => Boolean(play.iconPreference(UNAVAILABLE_PREF_KEY, false)));
  const [mobilePane, setMobilePane] = useState<'actions' | 'world'>('world');
  const [form, setForm] = useState<FormState | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [urgentAnnouncement, setUrgentAnnouncement] = useState('');
  const [claimFallback, setClaimFallback] = useState('suspend');
  const [claimController, setClaimController] = useState('');
  const [claimTimeout, setClaimTimeout] = useState('30');
  const { requireAcceptance, warningDialog } = useContentWarningGate(
    base => api.sendJson(base, '/public/world'),
  );
  const apiInputRef = useRef<HTMLInputElement>(null);
  const actionDialogRef = useRef<HTMLDialogElement>(null);
  const actionTriggerRef = useRef<HTMLElement | null>(null);
  const claimDialogRef = useRef<HTMLDialogElement>(null);
  const previousQueueSizeRef = useRef(0);
  const lobbyTimerRef = useRef<number | null>(null);
  const liveRef = useRef<{ close(): void } | null>(null);
  const liveTokenRef = useRef(0);
  const refreshTokenRef = useRef(0);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const liveStateRef = useRef('fallback');
  const mountedRef = useRef(true);
  const activityKeyRef = useRef(0);
  const eventImageRef = useRef('');
  const eventFailureRef = useRef<unknown>(null);
  const eventVideoRef = useRef('');
  const eventVideoFailureRef = useRef<unknown>(null);
  const pendingTargetRef = useRef(targetFromHash());
  const clientIdRef = useRef(String(play.persistentClientId(CLIENT_ID_KEY, 'web-tui')));
  const connectRef = useRef<(url: string) => void>(() => undefined);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const projectionHasTargetRef = useRef<(id: string) => boolean>(() => false);
  const selectTargetRef = useRef<(id: string, writeHash?: boolean) => void>(() => undefined);
  const submitFormRef = useRef<() => void>(() => undefined);

  const update = (next: Partial<Model> | ((current: Model) => Model)) => {
    const value = typeof next === 'function' ? next(modelRef.current) : { ...modelRef.current, ...next };
    modelRef.current = value;
    if (mountedRef.current) setModelState(value);
  };
  const activity = (text: string, kind = 'system', icon = '') => update(current => ({
    ...current,
    activity: [...current.activity, { icon, key: `activity-${++activityKeyRef.current}`, kind, text }].slice(-ACTIVITY_LIMIT),
  }));
  const announce = (text: string, urgent = false) => {
    if (urgent) setUrgentAnnouncement(text);
    else setAnnouncement(text);
  };
  const projectionHasTarget = (id: string) => {
    const current = modelRef.current;
    if (!id || !current.projection) return false;
    return id === current.playerId
      || (current.projection.room?.entities ?? []).some((entity: JsonObject) => entity.id === id)
      || (current.projection.inventory ?? []).some((item: JsonObject) => item.id === id)
      || targets().some(target => target.value === id);
  };
  const selectTarget = (id: string, writeHash = true) => {
    pendingTargetRef.current = '';
    update({ selectedId: id });
    if (!writeHash) return;
    const url = new URL(window.location.href);
    url.hash = id ? encodeURIComponent(id) : '';
    window.history.pushState(null, '', url);
  };

  const stopLive = () => {
    liveTokenRef.current += 1;
    liveRef.current?.close();
    liveRef.current = null;
  };
  const stopLobby = () => {
    if (lobbyTimerRef.current !== null) window.clearInterval(lobbyTimerRef.current);
    lobbyTimerRef.current = null;
  };

  const targets = () => play.allTargets(modelRef.current.projection) as { label: string; value: string }[];
  const nameFor = (id: string) => id === modelRef.current.playerId
    ? modelRef.current.characters.find(character => character.id === id)?.name ?? id
    : targets().find(target => target.value === id)?.label
      ?? (play.inventoryEntries(modelRef.current.projection) as JsonObject[]).find(item => item.id === id)?.label
      ?? modelRef.current.characters.find(character => character.id === id)?.name ?? null;

  const drainEvents = (events: JsonObject[], prime: boolean) => {
    const current = modelRef.current;
    const drained = play.drainNarratedEvents(events, {
      nameFor,
      playerId: current.playerId,
      roomOf: (id: string) => id === current.playerId ? current.projection?.room?.id ?? null : null,
      seenIds: current.seenEventIds,
    });
    const additions: JsonObject[] = [];
    const image = play.latestImageCompletion(events, { base: baseRef.current, purpose: 'event' });
    if (image?.url && image.url !== eventImageRef.current) {
      eventImageRef.current = image.url;
      if (!prime) additions.push({ kind: 'system', text: `${play.IMAGE_AFFORDANCE.DELIVER_EMOJI} scene image ready: ${image.url}` });
    }
    const failure = play.latestImageFailure(events, { purpose: 'event' });
    if (failure && failure.epoch !== eventFailureRef.current) {
      eventFailureRef.current = failure.epoch;
      if (!prime) additions.push({ kind: 'rejection', text: `${play.IMAGE_AFFORDANCE.FAIL_EMOJI} image request failed: ${failure.reason}` });
    }
    const video = latestVideoCompletion(
      events,
      url => api.mediaUrl(baseRef.current, url),
    );
    if (video?.url && video.url !== eventVideoRef.current) {
      eventVideoRef.current = video.url;
      if (!prime) additions.push({ kind: 'system', text: `${VIDEO_AFFORDANCE.DELIVER_EMOJI} scene video ready: ${video.url}` });
    }
    const videoFailure = latestVideoFailure(events);
    if (videoFailure && videoFailure.epoch !== eventVideoFailureRef.current) {
      eventVideoFailureRef.current = videoFailure.epoch;
      if (!prime) additions.push({ kind: 'rejection', text: `${VIDEO_AFFORDANCE.FAIL_EMOJI} video request failed: ${videoFailure.reason}` });
    }
    if (!prime) additions.push(...drained.lines);
    update({
      activity: [...current.activity, ...additions.map(line => ({ ...line, key: `activity-${++activityKeyRef.current}` }))].slice(-ACTIVITY_LIMIT) as Model['activity'],
      seenEventIds: drained.seenIds,
    });
  };

  const refreshOnce = async () => {
    const current = modelRef.current;
    if (!current.connected || !baseRef.current) return;
    const base = baseRef.current;
    const token = ++refreshTokenRef.current;
    let claimRequest = false;
    try {
      const [list, features] = await Promise.all([
        play.fetchCharacterList(base),
        api.fetchFeatures
          ? api.fetchFeatures(base).then(value => ({
            imageGeneration: value.image_generation === true,
            videoGeneration: value.video_generation === true,
          }))
          : fetchGenerationFeatures(api.sendJson, base),
      ]);
      if (!mountedRef.current || token !== refreshTokenRef.current || base !== baseRef.current || !modelRef.current.connected) return;
      const characters = list.characters ?? [];
      update({
        characters,
        features: {
          imageGeneration: features.imageGeneration,
          videoGeneration: features.videoGeneration,
        },
      });
      const playerId = modelRef.current.playerId;
      if (playerId && !characters.some((character: Character) => character.id === playerId)) {
        dropPlayer();
        return;
      }
      if (playerId && modelRef.current.control) {
        claimRequest = true;
        const { character: projection, queued } = await play.fetchClaimProjection(
          base, playerId, modelRef.current.control,
        );
        if (!mountedRef.current || token !== refreshTokenRef.current || base !== baseRef.current || playerId !== modelRef.current.playerId) return;
        update({
          control: play.syncClaimControl(modelRef.current.control, projection, playerId),
          projection,
          queued: queued?.commands ?? [],
          queueProjection: queued?.characterId === playerId ? queued : null,
        });
        const events = await play.fetchCharacterRecentEvents(base, playerId, modelRef.current.control);
        if (!mountedRef.current || token !== refreshTokenRef.current || base !== baseRef.current || playerId !== modelRef.current.playerId) return;
        drainEvents(events.events ?? [], !modelRef.current.eventsPrimed);
        update({ eventsPrimed: true });
      }
      if (!playerId || (modelRef.current.control && liveStateRef.current === 'live')) {
        update({ status: { kind: 'live', text: `● Live · epoch ${modelRef.current.projection?.worldEpoch || list.epoch || 0}s` } });
      }
    } catch (error) {
      if (token !== refreshTokenRef.current || base !== baseRef.current) return;
      const playerId = modelRef.current.playerId;
      if (claimRequest && playerId && play.isClaimNotFoundError(error)) {
        play.clearClaimControl(CLIENT_ID_KEY, playerId);
        stopLive();
        update({
          control: null, projection: null, queued: [], queueProjection: null, selectedId: '',
          status: { kind: 'err', text: '⚠ Claim expired. Claim again to continue.' },
        });
        announce('Your play session expired. Choose Play to continue.', true);
        startLobby();
        return;
      }
      const text = message(error);
      update({ status: { kind: 'err', text: `⚠ ${text}` } });
      announce(text, true);
    }
  };
  const refresh = () => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const request = refreshOnce();
    refreshPromiseRef.current = request;
    const clear = () => {
      if (refreshPromiseRef.current === request) refreshPromiseRef.current = null;
    };
    void request.then(clear, clear);
    return request;
  };
  refreshRef.current = refresh;

  const startLobby = () => {
    stopLobby();
    lobbyTimerRef.current = window.setInterval(() => { void refreshRef.current(); }, 2000);
    void refreshRef.current();
  };
  const startLive = () => {
    stopLive();
    stopLobby();
    const current = modelRef.current;
    if (!current.connected || !baseRef.current || !current.playerId) return;
    const token = ++liveTokenRef.current;
    liveRef.current = play.createPlayerLiveUpdates({
      base: baseRef.current,
      characterId: current.playerId,
      control: current.control,
      onState: (state: string) => {
        if (token !== liveTokenRef.current) return;
        liveStateRef.current = state;
        if (state === 'live') update({ status: { kind: 'live', text: '● Live' } });
        else if (state !== 'closed') update({ status: { kind: 'err', text: '◌ Reconnecting · polling' } });
      },
      refresh: () => refreshRef.current(),
    });
  };

  const disconnect = (syncUrl = true) => {
    refreshTokenRef.current += 1; refreshPromiseRef.current = null; stopLive(); stopLobby();
    if (syncUrl && baseRef.current) api.setServerInUrl('');
    baseRef.current = '';
    update({ ...initial, seenEventIds: new Set() });
  };
  const connect = (url: string) => {
    if (!url) return;
    disconnect(false);
    const base = String(api.normalizeBase(url));
    baseRef.current = base;
    update({ connected: true, status: { kind: 'live', text: '● Connected' } });
    announce('Connected to Bunnyland. Choose a character to play.');
    api.setServerInUrl(base);
    startLobby();
  };
  connectRef.current = connect;

  const claimPlayer = async (id: string) => {
    const stored = play.storedClaimControl(CLIENT_ID_KEY, id);
    const data = await play.claimWebController(baseRef.current, {
      ...play.claimSettings(), character_id: id, claim_id: stored?.claimId || undefined,
      client_id: clientIdRef.current, label: 'web-tui',
    }, stored);
    const control = play.controlFromResponse(data, id, { active: true });
    play.storeClaimControl(CLIENT_ID_KEY, control);
    return control;
  };
  const selectPlayer = async (id: string) => {
    update({ control: null, playerId: id, projection: null, queued: [], queueProjection: null, selectedId: '' });
    if (!id) {
      dropPlayer();
      return;
    }
    let accepted = false;
    try {
      accepted = await requireAcceptance(baseRef.current);
    } catch (error) {
      update({ status: { kind: 'error', text: `⚠ ${error instanceof Error ? error.message : String(error)}` } });
    }
    if (!accepted) {
      dropPlayer();
      return;
    }
    const control = await claimPlayer(id);
    if (!mountedRef.current || id !== modelRef.current.playerId) return;
    refreshTokenRef.current += 1;
    refreshPromiseRef.current = null;
    update({ control });
    announce(`Playing as ${modelRef.current.characters.find(character => character.id === id)?.name ?? id}.`);
    startLive(); await refreshRef.current();
  };
  function dropPlayer() {
    refreshTokenRef.current += 1;
    refreshPromiseRef.current = null;
    stopLive();
    update({ control: null, playerId: '', projection: null, queued: [], queueProjection: null, selectedId: '' });
    if (modelRef.current.connected) startLobby();
  }

  projectionHasTargetRef.current = projectionHasTarget;
  selectTargetRef.current = selectTarget;
  submitFormRef.current = submitForm;

  useEffect(() => {
    mountedRef.current = true;
    globals.BunnylandUI.initClientMenu();
    globals.BunnylandUI.initHelp({
      title: 'Bunnyland Web TUI — controls',
      intro: 'The Web TUI is a list-based client: rooms, exits, characters and your inventory are shown as lists you click to act on.',
      sections: [
        { title: 'Playing', items: [
          { label: 'Pick a character', desc: 'Choose one from the Character selector, then act as them. Release hands it back.', key: 'Character' },
        ] },
        { title: 'Acting', items: [
          { label: 'Actions', desc: 'Each verb shows its AP / FP cost; click one and fill in any target or text it needs.' },
          { label: 'Change rooms', desc: 'Click an exit in the Doors list to move (or queue) through it.' },
          { label: 'Inventory', desc: "Lists what you're carrying; click an item to select it as a verb's target." },
          { label: 'Clear target', desc: 'Clear Target removes the selected room or inventory target without releasing your character.', key: 'Clear Target' },
          { label: 'Queued actions', desc: 'Actions you cannot afford yet run on the next tick. Click one to cancel it.' },
        ] },
        { title: 'Scene image', items: [
          { label: 'Request an image', desc: "Generate an image of your character's current scene.", key: `${play.IMAGE_AFFORDANCE.REQUEST_EMOJI} Image` },
          { label: 'When it is ready', desc: `${play.IMAGE_AFFORDANCE.DELIVER_EMOJI} a link appears in the activity log. ${play.IMAGE_AFFORDANCE.FAIL_EMOJI} shows there if it fails.` },
        ] },
        { title: 'More', items: [
          { label: 'Character sheet', desc: "Open the selected (or your own) character's sheet.", key: '▣ Sheet' },
          { label: 'Switch clients / theme', desc: 'The client menu lists every client and editor and sets the theme.', key: 'Menu' },
        ] },
      ],
    });
    const facade = {
      get characters() { return modelRef.current.characters; },
      get control() { return modelRef.current.control; },
      get projection() { return modelRef.current.projection; },
      refresh: () => refreshRef.current(),
    };
    pageWindow.app = facade;
    const applyTargetHash = () => {
      const id = targetFromHash();
      if (!id) { pendingTargetRef.current = ''; update({ selectedId: '' }); return; }
      if (projectionHasTargetRef.current(id)) selectTargetRef.current(id, false);
      else { pendingTargetRef.current = id; update({ selectedId: '' }); }
    };
    window.addEventListener('hashchange', applyTargetHash);
    window.addEventListener('popstate', applyTargetHash);
    void api.applyConfigToInput({ connect: (server: string) => connectRef.current(server), isConnected: () => modelRef.current.connected });
    api.applyServerParam({ connect: (server: string) => connectRef.current(server) });
    return () => {
      mountedRef.current = false; refreshTokenRef.current += 1; stopLive(); stopLobby();
      window.removeEventListener('hashchange', applyTargetHash);
      window.removeEventListener('popstate', applyTargetHash);
      if (pageWindow.app === facade) delete pageWindow.app;
    };
  }, []);

  useEffect(() => {
    const id = pendingTargetRef.current;
    if (id && projectionHasTargetRef.current(id)) selectTargetRef.current(id, false);
  }, [model.projection]);

  useEffect(() => {
    const previous = previousQueueSizeRef.current;
    const next = model.queued.length;
    if (next > previous) announce(`${next - previous} action${next - previous === 1 ? '' : 's'} added to the queue.`);
    else if (next < previous) announce(`${previous - next} queued action${previous - next === 1 ? '' : 's'} cleared.`);
    previousQueueSizeRef.current = next;
  }, [model.queued.length]);

  useLayoutEffect(() => {
    if (!form) return;
    const dialog = actionDialogRef.current;
    if (dialog && typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeAction(); return; }
      if (event.key === 'Enter' && (event.target as HTMLElement).classList.contains('form-input')) submitFormRef.current();
      if (event.key !== 'Tab' || !dialog || typeof dialog.showModal === 'function') return;
      const fields = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      const first = fields[0]; const last = fields.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    dialog?.querySelector<HTMLElement>('.form-input')?.focus();
    return () => {
      document.removeEventListener('keydown', keydown);
      if (dialog?.open && typeof dialog.close === 'function') dialog.close();
    };
  }, [form]);

  const filteredActions = play.filterActions(model.projection?.actions ?? [], filter.trim().toLowerCase()) as Action[];
  const hiddenUnavailableCount = filteredActions.filter(action => !play.actionAvailable(action)).length;
  const actions = showUnavailable ? filteredActions : filteredActions.filter(action => play.actionAvailable(action));
  const currentRoom = model.projection?.room;
  const inventory = play.inventoryEntries(model.projection) as JsonObject[];
  const allActions = model.projection?.actions ?? [];
  const actionRows = useMemo<TuiActionRow[]>(() => actions.map((action, index) => {
    const cost = play.actionCost(action); const lane = play.actionLane(action);
    return {
      actionCost: Number(cost.action || 0), available: Boolean(play.actionAvailable(action)), focusCost: Number(cost.focus || 0),
      icon: showIcons ? play.actionIcon(action) : '', index, key: `${lane}:${play.actionCommandType(action)}:${play.actionTool(action)}`,
      lane, ready: Boolean(model.playerId && model.projection), reason: play.actionUnavailableReason(action),
      target: play.actionArguments(action).some((argument: JsonObject) => argument.target_group), title: play.actionTitle(action),
    };
  }), [actions, model.playerId, model.projection, showIcons]);

  const openAction = (action: Action) => {
    const fields = play.actionFields(action, (group: string) => modelRef.current.projection?.targetGroups?.[group] ?? []) as FormField[];
    if (!fields.length) { void doAction(action, {}); return; }
    const values = Object.fromEntries(fields.map(field => [field.key,
      field.candidates?.some(candidate => candidate.value === modelRef.current.selectedId) ? modelRef.current.selectedId : '',
    ]));
    actionTriggerRef.current = document.activeElement as HTMLElement | null;
    setForm({ action, error: '', fields, values });
  };
  const closeAction = () => {
    setForm(null);
    window.requestAnimationFrame(() => actionTriggerRef.current?.focus());
  };
  async function doAction(action: Action, payload: JsonObject) {
    const current = modelRef.current;
    if (!current.playerId || !current.control) return;
    const cost = play.actionCost(action);
    const result = await play.submitCommand(baseRef.current, {
      character_id: current.playerId, claim_id: current.control.claimId,
      command_type: play.actionCommandType(action), controller_generation: current.control.generation,
      controller_id: current.control.controllerId, cost, lane: play.actionLane(action),
      on_insufficient_points: 'queue', payload,
    }, current.control);
    if (result?.queued === false) {
      const reason = result.reason || 'Command rejected.';
      activity(reason, 'rejection');
      announce(reason, true);
    }
    await refreshRef.current();
  }
  function submitForm() {
    if (!form) return;
    for (const field of form.fields) {
      if (field.required && !form.values[field.key]?.trim()) {
        setForm({ ...form, error: `${field.label} is required.` }); return;
      }
    }
    const payload = Object.fromEntries(Object.entries(form.values).filter(([, value]) => value.trim()));
    const action = form.action; closeAction(); void doAction(action, payload);
  }

  const moveExit = async (index: number) => {
    const exit = currentRoom?.exits?.[index]; const current = modelRef.current;
    if (!exit || !current.control) return;
    const action = allActions.find(item => play.actionArguments(item).some((argument: JsonObject) => argument.target_group === 'exits'));
    const argument = action && play.actionArguments(action).find((item: JsonObject) => item.target_group === 'exits');
    if (action && argument) await doAction(action, { [argument.key]: exit.id });
  };

  const requestImage = async () => {
    if (!modelRef.current.playerId) activity('Select a character before requesting an image.');
    else {
      try { activity(play.imageRequestMessage(await api.requestSceneImage(baseRef.current, modelRef.current.playerId, modelRef.current.control))); }
      catch (error) { activity(`${play.IMAGE_AFFORDANCE.REQUEST_EMOJI} ${message(error)}`, 'rejection'); }
    }
    await refreshRef.current();
  };
  const requestVideo = async () => {
    if (!modelRef.current.playerId) activity('Select a character before requesting a video.');
    else {
      try { activity(videoRequestMessage(await requestSceneVideo(api, baseRef.current, modelRef.current.control))); }
      catch (error) { activity(`${VIDEO_AFFORDANCE.REQUEST_EMOJI} ${message(error)}`, 'rejection'); }
    }
    await refreshRef.current();
  };
  const openSheet = () => {
    const current = modelRef.current;
    if (!current.playerId) { activity('Select a character before opening a sheet.'); return; }
    let id = current.playerId;
    if (current.selectedId && current.selectedId !== current.playerId) {
      const selected = current.projection?.room?.entities?.find((entity: JsonObject) => entity.id === current.selectedId);
      if (!selected || !(selected.is_character || selected.kind === 'character')) {
        activity('Select a visible character or clear the target.', 'rejection'); return;
      }
      id = current.selectedId;
    }
    const href = play.characterHref(baseRef.current, id);
    const opened = window.open(href, '_blank', 'noopener'); activity(opened ? `Opened sheet: ${href}` : `Sheet URL: ${href}`);
  };

  const claimPayload = () => ({
    ...play.claimSettings(), character_id: modelRef.current.playerId, claim_id: modelRef.current.control?.claimId,
    client_id: clientIdRef.current, fallback_controller: claimFallback,
    fallback_controller_id: claimController.trim() || null, timeout_seconds: Number(claimTimeout || 30) * 60,
  });
  const saveFallback = async () => {
    try {
      const current = modelRef.current; const data = await play.updateWebControllerFallback(baseRef.current, claimPayload(), current.control);
      const control = play.controlFromResponse(data, current.playerId, { active: current.control?.active !== false });
      play.storeClaimControl(CLIENT_ID_KEY, control); update({ control });
    } catch (error) { update({ status: { kind: 'err', text: `⚠ ${message(error)}` } }); }
  };
  const releaseController = async () => {
    const current = modelRef.current;
    try {
      const data = await play.releaseWebController(baseRef.current, claimPayload(), current.control);
      const control = play.controlFromResponse(data, current.playerId, { active: false });
      play.storeClaimControl(CLIENT_ID_KEY, control); update({ control }); await refreshRef.current();
    } catch (error) { update({ status: { kind: 'err', text: `⚠ ${message(error)}` } }); }
  };
  const releaseClaim = async () => {
    const current = modelRef.current;
    try {
      await play.releaseWebClaim(baseRef.current, {
        character_id: current.playerId, claim_id: current.control?.claimId, client_id: clientIdRef.current,
      }, current.control);
      play.clearClaimControl(CLIENT_ID_KEY, current.playerId); claimDialogRef.current?.close(); dropPlayer();
    } catch (error) { update({ status: { kind: 'err', text: `⚠ ${message(error)}` } }); }
  };

  const points = model.projection?.points ?? {};
  const selectedLabel = model.selectedId ? nameFor(model.selectedId) || model.selectedId : 'none';
  const members = (currentRoom?.entities ?? []).filter((entity: JsonObject) => entity.kind !== 'room').map((entity: JsonObject) => ({
    icon: play.entityIcon(entity), id: entity.id || '', isPlayer: entity.id === model.playerId, kind: entity.kind || '',
    label: entity.name || entity.id || '', selected: entity.id === model.selectedId,
  }));
  const exits = (currentRoom?.exits ?? []).map((exit: JsonObject, index: number) => ({
    index, key: [exit.id, exit.direction, exit.label].filter(Boolean).join(':') || String(index),
    label: exit.direction || exit.label || exit.id || '', locked: Boolean(exit.locked),
  }));

  return <>
    <div class="bl-visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</div>
    <div class="bl-visually-hidden" role="alert" aria-atomic="true">{urgentAnnouncement}</div>
    <div id="toolbar">
      <div class="toolbar-row toolbar-heading" id="toolbar-row1"><span class="toolbar-brand"><img src="favicon.png" alt="" /> Bunnyland Web TUI</span>
        <button id="btn-client-menu" class="client-menu-button" type="button">Menu</button><button id="btn-help" type="button" title="Help — controls & commands (press ?)" aria-label="Help">?</button>
      </div>
      <details id="connection-details" open={!model.connected}>
        <summary>{model.connected ? 'Connected · connection details' : 'Connect to a server'}</summary>
        <div class="toolbar-row" id="toolbar-row2"><label for="api-url">Server:</label><input ref={apiInputRef} type="text" id="api-url" defaultValue="/api/v1/" spellcheck={false} />
          <button id="btn-connect" onClick={() => model.connected ? disconnect() : connect(apiInputRef.current?.value.trim() ?? '')}>{model.connected ? 'Disconnect' : 'Connect Live'}</button>
          <span id="api-status" class={model.status.kind} role="status">{model.status.text}</span>
        </div>
      </details>
      <div class="toolbar-row" id="toolbar-row3"><label for="player-select">Character:</label>
        <select id="player-select" value={model.playerId} onChange={event => event.currentTarget.value ? void selectPlayer(event.currentTarget.value) : dropPlayer()}>
          <option value="">— select to play —</option>{model.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
        </select>
        <button id="btn-release-character" type="button" disabled={!model.playerId} onClick={() => claimDialogRef.current?.showModal()}>
          {!model.playerId || !model.control ? 'Play' : model.control.active === false ? 'Play' : 'Step away'}
        </button>
        {model.features.imageGeneration && <button id="btn-request-image" type="button" title="Request an image of your current scene" onClick={() => { void requestImage(); }}>📷 Image</button>}
        {model.features.videoGeneration && <button id="btn-request-video" type="button" title="Generate a short video of recent events" onClick={() => { void requestVideo(); }}>🎬 Video</button>}
        <button id="btn-open-sheet" type="button" title="Open the selected or current character sheet" onClick={openSheet}>▣ Sheet</button>
      </div>
    </div>
    <dialog id="claim-dialog" ref={claimDialogRef} aria-labelledby="claim-dialog-title"><form method="dialog" class="claim-dialog-form"><h2 id="claim-dialog-title">Playing as this character</h2>
      <p>Step away to keep this character reserved for you, or release it so someone else can play.</p>
      <details class="claim-advanced"><summary>Advanced handoff settings</summary>
        <label for="claim-fallback">When I step away</label><select id="claim-fallback" value={claimFallback} onChange={event => setClaimFallback(event.currentTarget.value)}>
          <option value="suspend">Suspend the character</option><option value="llm">Hand off to an AI</option><option value="controller">Use a specific controller</option></select>
        <label for="claim-fallback-controller">Controller ID</label><input type="text" id="claim-fallback-controller" spellcheck={false} placeholder="entity_..." value={claimController} onInput={event => setClaimController(event.currentTarget.value)} />
        <label for="claim-timeout">Step-away timeout (minutes)</label><input type="number" id="claim-timeout" min="5" max="60" step="1" value={claimTimeout} onInput={event => setClaimTimeout(event.currentTarget.value)} />
        <button id="btn-dialog-save-fallback" type="button" onClick={() => { void saveFallback(); }}>Save handoff settings</button>
      </details>
      <div class="dialog-actions"><button id="btn-dialog-claim" type="button" onClick={() => { void selectPlayer(model.playerId); }}>Play</button>
        <button id="btn-dialog-release-controller" type="button" onClick={() => { void releaseController(); }}>Step away</button>
        <button id="btn-dialog-release-claim" type="button" onClick={() => { void releaseClaim(); }}>Release character</button><button type="submit">Close</button></div>
    </form></dialog>
    <div id="mobile-pane-tabs" role="tablist" aria-label="Player panes">
      <button id="tab-world" type="button" role="tab" aria-controls="world-pane" aria-selected={mobilePane === 'world'} onClick={() => setMobilePane('world')}>World</button>
      <button id="tab-actions" type="button" role="tab" aria-controls="actions-pane" aria-selected={mobilePane === 'actions'} onClick={() => setMobilePane('actions')}>Actions{model.queued.length ? ` (${model.queued.length})` : ''}</button>
    </div>
    <div id="main" class="app-grid">
      <section id="world-pane" role="tabpanel" aria-labelledby="tab-world" tabIndex={0} data-mobile-active={mobilePane === 'world'}><div id="room-title" class="pane-title">{currentRoom?.title || 'Room'}</div>
        {currentRoom?.description ? <div id="room-description">{String(currentRoom.description)}</div> : null}
        <div id="members" class="option-list" tabIndex={0} aria-labelledby="room-title"><MemberList empty="Select a character above to play as and see their room." items={members} onSelect={id => selectTarget(id)} /></div>
        <div id="doors-title" class="pane-title">Doors</div><div id="doors" class="option-list" tabIndex={0} aria-labelledby="doors-title"><ExitList empty="No visible exits." items={exits} onSelect={value => { void moveExit(Number(value)); }} /></div>
        <div id="inventory-title" class="pane-title">Inventory</div><div id="inventory" class="option-list" tabIndex={0} aria-labelledby="inventory-title"><InventoryList empty={model.playerId ? 'Nothing carried.' : 'Select a character above.'}
          items={inventory.map(item => ({ icon: item.icon || '', id: item.id || '', kind: item.kind || '', label: item.label || '', selected: item.id === model.selectedId }))} onSelect={id => selectTarget(id)} /></div>
        <div id="activity-title" class="pane-title">Activity</div><div id="activity" class="option-list" tabIndex={0} aria-labelledby="activity-title"><ActivityRows rows={model.activity.map(line => ({
          icon: showIcons ? line.icon || '' : '', key: line.key, kind: line.kind || '', text: line.text,
        })) as TuiActivityRow[]} /></div>
      </section>
      <aside id="actions-pane" role="tabpanel" aria-labelledby="tab-actions" data-mobile-active={mobilePane === 'actions'}><div id="action-controls">
        <div id="points-line">{model.playerId && model.projection ? <><span class="point ap"><span class={`point-pip${Number(points.action || 0) > 0 ? '' : ' zero'}`}>⚡</span> {play.formatPoints(points.action)} / {play.formatPoints(points.action_max)} AP</span>{'   '}<span class="point fp"><span class={`point-pip${Number(points.focus || 0) > 0 ? '' : ' zero'}`}>🔹</span> {play.formatPoints(points.focus)} / {play.formatPoints(points.focus_max)} FP</span></> : 'Select a character to play as and see their actions.'}</div>
        <div id="target-line"><span id="target-label">Target: {selectedLabel}</span><button id="btn-clear-target" type="button" title="Clear the selected action target" disabled={!model.selectedId} onClick={() => selectTarget('')}>Clear Target</button></div>
        <div id="action-filter-row"><input id="action-filter" type="text" placeholder="Search actions" spellcheck={false} value={filter} onInput={event => setFilter(event.currentTarget.value)} />
          <button id="action-filter-clear" type="button" onClick={() => setFilter('')}>Clear</button><label class="icon-toggle" title="Show action and activity icons"><input id="show-action-icons" type="checkbox" checked={showIcons}
            onChange={event => { setShowIcons(event.currentTarget.checked); play.setIconPreference(ICON_PREF_KEY, event.currentTarget.checked); }} /> Icons</label></div>
        <label class="unavailable-toggle"><input id="show-unavailable-actions" type="checkbox" checked={showUnavailable}
          onChange={event => { setShowUnavailable(event.currentTarget.checked); play.setIconPreference(UNAVAILABLE_PREF_KEY, event.currentTarget.checked); }} />
          Show unavailable{!showUnavailable && hiddenUnavailableCount ? ` (${hiddenUnavailableCount} hidden)` : ''}</label>
      </div><div id="verbs"><ActionSections actions={actionRows} onAction={index => { const action = actions[index]; if (action) openAction(action); }} /></div>
        <div id="queued"><LiveQueuedRows countdownFor={() => play.queuedCountdownSeconds(model.queueProjection) as number | null} source={model.queueProjection} rows={model.queued.map(command => ({ id: command.command_id || '', label: play.queuedCommandLabel(command, allActions) }))}
          onCancel={async id => { try { await play.cancelQueuedCommand(baseRef.current, modelRef.current.playerId, id, modelRef.current.control); await refreshRef.current(); } catch (error) { update({ status: { kind: 'err', text: `⚠ ${message(error)}` } }); } }} /></div>
      </aside>
    </div>
    {form ? <dialog id="action-form-dialog" ref={actionDialogRef} aria-labelledby="action-form-title" onCancel={event => { event.preventDefault(); closeAction(); }}>
      <form method="dialog" class="form-card" onSubmit={event => { event.preventDefault(); submitForm(); }}>
      <h2 id="action-form-title" class="form-title">{play.actionTitle(form.action)}</h2><div class="form-body">{form.fields.map(field => <label class="form-field" key={field.key}><span>{field.label}{field.required ? ' *' : ''}</span>
        {field.candidates ? <select class="form-input" value={form.values[field.key] ?? ''} onChange={event => setForm({ ...form, values: { ...form.values, [field.key]: event.currentTarget.value } })}>
          <option value="">— choose —</option>{field.candidates.map(candidate => <option value={candidate.value} key={candidate.value}>{candidate.icon} {candidate.label}</option>)}</select>
          : field.kind === 'boolean' ? <select class="form-input" value={form.values[field.key] ?? ''} onChange={event => setForm({ ...form, values: { ...form.values, [field.key]: event.currentTarget.value } })}>
            <option value="">— choose —</option><option value="true">yes</option><option value="false">no</option></select>
            : <input class="form-input" type={field.kind === 'number' ? 'number' : 'text'} value={form.values[field.key] ?? ''} onInput={event => setForm({ ...form, values: { ...form.values, [field.key]: event.currentTarget.value } })} />}</label>)}
        <div class="form-error" role="alert">{form.error}</div></div><div class="form-buttons"><button class="form-cancel" type="button" onClick={closeAction}>Cancel</button><button class="form-submit" type="submit">Submit</button></div>
    </form></dialog> : null}
    {warningDialog}
  </>;
}

const root = document.getElementById('app');
if (root) render(<AuthProvider base={serverFromUrl() || '/api/v1'}><AuthGate scopes={['world:play']}><WebTuiPage /></AuthGate></AuthProvider>, root);
