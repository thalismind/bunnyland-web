import {
  AuthGate,
  AuthProvider,
  Button,
  StatusText,
  Toolbar,
  ToolbarBrand,
  ToolbarRow,
  useAuth,
} from '@bunnyland/ui-web/preact';
import { render } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import {
  actionSummary,
  type ChatAction,
  chatStorageKey,
  HISTORY_LIMIT,
  historyForPayload,
  type JsonObject,
  loadChatState,
  plainMessageHtml,
  renderMarkdown,
  saveChatState,
  type StoredMessage,
} from './chat-state';
import {
  clearRememberedNarrative,
  rememberOnThisDevice,
  setRememberOnThisDevice,
} from '../device-remembrance';
import { MetricList, type SheetMetric } from './metrics';
import { Overview, PillList, SheetList, type OverviewContent, type SheetRow } from './sections';
import { Transcript, type TranscriptItem } from './transcript';
import './page.css';

const DOCUMENT_TITLE_BASE = 'Bunnyland Character';
const CHAT_CLIENT_ID_KEY = 'bunnyland.characterChat.clientId';
const MARKDOWN_KEY = 'bunnyland.characterChat.markdown';
const LOBBY_POLL_INTERVAL_MS = 2000;
const PENDING_POLL_MS = 2000;

export interface SheetCharacter {
  id: string;
  kind: string;
  name: string;
  suspended?: boolean;
}

export interface SheetEntry {
  detail?: string;
  label?: string;
  value?: string;
}

export interface SheetProjection {
  characterId: string;
  characterName: string;
  controller: {
    controller_id?: string;
    detail?: string;
    generation?: number;
    kind?: string;
    name?: string;
  } | null;
  points: Record<string, number>;
  portrait?: { url?: string };
  room: { id?: string; title?: string };
  sheet?: OverviewContent & {
    affect?: SheetMetric[];
    injuries?: SheetEntry[];
    kind?: string;
    needs?: SheetMetric[];
    notes?: SheetEntry[];
    profile?: SheetEntry[];
    relations?: SheetEntry[];
    skills?: SheetEntry[];
    species?: string;
    status?: string[];
    traits?: string[];
    vitals?: SheetMetric[];
  };
  worldEpoch: number;
}

export interface LlmControllerOption {
  detail: string;
  id: string;
  label: string;
}

type CharacterChatLifecycle = 'dead' | 'downed' | 'sleeping' | 'suspended' | '';

function characterChatLifecycle(projection: SheetProjection | null): CharacterChatLifecycle {
  const statuses = new Set(
    (projection?.sheet?.status || []).map((status) => (
      status.split(' (', 1)[0] || ''
    ).trim().toLowerCase()),
  );
  if (statuses.has('dead')) return 'dead';
  if (statuses.has('downed')) return 'downed';
  if (statuses.has('sleeping')) return 'sleeping';
  if (statuses.has('suspended')) return 'suspended';
  return '';
}

function characterChatLifecycleUnavailable(
  lifecycle: CharacterChatLifecycle,
  allowSleepingCharacterChat: boolean,
): boolean {
  return lifecycle === 'dead'
    || lifecycle === 'downed'
    || (lifecycle === 'sleeping' && !allowSleepingCharacterChat);
}

interface FeatureStatus {
  character_chat?: boolean;
  allow_sleeping_character_chat?: boolean;
  character_sheets?: boolean;
}

export type CharacterView = 'chat' | 'sheet';

interface UploadOptions {
  getAuth: () => string | null;
  setAuth: (auth: string | null) => void;
}

export interface CharacterServices {
  actionIcon: (action: { command_type: string; tool_name: string }) => string;
  applyConfig: (options: {
    connect: (server: string) => void;
    isConnected: () => boolean;
  }) => Promise<unknown>;
  assignController: (base: string, characterId: string, controllerId: string) => Promise<void>;
  fetchCharacterList: (base: string) => Promise<{ characters?: SheetCharacter[]; epoch?: number }>;
  fetchCharacterProfile: (base: string, characterId: string) => Promise<SheetProjection | null>;
  fetchLlmControllers: (base: string) => Promise<LlmControllerOption[]>;
  formatPoints: (value: unknown) => string;
  initClientMenu: () => { close?: () => void } | void;
  initTheme: () => unknown;
  mediaUrl: (base: string, url: string) => string;
  normalizeBase: (url: string) => string;
  persistentClientId: (key: string, prefix: string) => string;
  portraitStatusMessage: (projection: SheetProjection | null, state: string) => string;
  serverFromUrl: () => string;
  sendJson: (base: string, path: string, options?: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
  }) => Promise<JsonObject>;
  setServerInUrl: (base: string) => void;
  uploadCharacterImage: (
    base: string, characterId: string, purpose: string, file: File, options: UploadOptions,
  ) => Promise<{ url?: string }>;
}

interface LegacyWindow extends Window {
  BunnylandApi: {
    applyConfigToInput: CharacterServices['applyConfig'];
    mediaUrl: CharacterServices['mediaUrl'];
    normalizeBase: CharacterServices['normalizeBase'];
    sendJson: CharacterServices['sendJson'];
    serverFromUrl: CharacterServices['serverFromUrl'];
    setServerInUrl: CharacterServices['setServerInUrl'];
    uploadCharacterImage: CharacterServices['uploadCharacterImage'];
  };
  BunnylandPlay: Pick<CharacterServices,
    'actionIcon' | 'fetchCharacterProfile' | 'formatPoints' | 'persistentClientId' |
    'portraitStatusMessage'> & {
      fetchCharacterProfileList: CharacterServices['fetchCharacterList'];
    };
  BunnylandUI: {
    initClientMenu: CharacterServices['initClientMenu'];
    initTheme: CharacterServices['initTheme'];
  };
}

function browserServices(): CharacterServices {
  const legacy = window as unknown as LegacyWindow;
  return {
    ...legacy.BunnylandPlay,
    assignController: async (base, characterId, controllerId) => {
      await legacy.BunnylandApi.sendJson(
        base,
        `/admin/characters/${encodeURIComponent(characterId)}/controller`,
        { body: JSON.stringify({ controller_id: controllerId }), method: 'PUT' },
      );
    },
    fetchCharacterList: (base) => legacy.BunnylandPlay.fetchCharacterProfileList(base),
    fetchLlmControllers: async (base) => parseLlmControllerOptions(
      await legacy.BunnylandApi.sendJson(base, '/admin/world/snapshot'),
    ),
    applyConfig: (options) => legacy.BunnylandApi.applyConfigToInput(options),
    initClientMenu: () => legacy.BunnylandUI.initClientMenu(),
    initTheme: () => legacy.BunnylandUI.initTheme(),
    mediaUrl: (base, url) => legacy.BunnylandApi.mediaUrl(base, url),
    normalizeBase: (url) => legacy.BunnylandApi.normalizeBase(url),
    sendJson: (base, path, options) => legacy.BunnylandApi.sendJson(base, path, options),
    serverFromUrl: () => legacy.BunnylandApi.serverFromUrl(),
    setServerInUrl: (base) => legacy.BunnylandApi.setServerInUrl(base),
    uploadCharacterImage: (base, id, purpose, file, options) => (
      legacy.BunnylandApi.uploadCharacterImage(base, id, purpose, file, options)
    ),
  };
}

const DEFAULT_BROWSER_SERVICES = browserServices();

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseLlmControllerOptions(snapshot: JsonObject): LlmControllerOption[] {
  if (!Array.isArray(snapshot.entities)) throw new Error('World snapshot entities must be an array.');
  const options: LlmControllerOption[] = [];
  for (const value of snapshot.entities) {
    if (!isJsonObject(value) || typeof value.id !== 'string' || !isJsonObject(value.components)) continue;
    const component = value.components.LLMControllerComponent;
    if (!isJsonObject(component)) continue;
    const profile = typeof component.profile_name === 'string' && component.profile_name.trim()
      ? component.profile_name.trim()
      : 'default';
    const provider = typeof component.provider === 'string' ? component.provider.trim() : '';
    const model = typeof component.model === 'string' ? component.model.trim() : '';
    options.push({
      detail: [provider, model].filter(Boolean).join('/'),
      id: value.id,
      label: profile,
    });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hashCharacterId(): string {
  try {
    return decodeURIComponent(location.hash.replace(/^#/, '')).trim();
  } catch {
    return '';
  }
}

export function viewFromUrl(href = location.href): CharacterView {
  return new URL(href).searchParams.get('view') === 'chat' ? 'chat' : 'sheet';
}

export function characterViewUrl(href: string, view: CharacterView): string {
  const url = new URL(href);
  if (view === 'chat') url.searchParams.set('view', 'chat');
  else url.searchParams.delete('view');
  return url.href;
}

export function characterInitials(name: string): string {
  const source = name || '?';
  const withoutTitle = source.replace(
    /^(?:(?:mr|mrs|ms|miss|mx|dr|doctor|prof|sir|dame|lord|lady|rev|fr|hon|capt|cpt|lt|sgt|col|gen|adm|judge)\.?\s+)+/i,
    '',
  ).trim() || source;
  return withoutTitle.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?';
}

function entryRows(entries: SheetEntry[] = []): SheetRow[] {
  const occurrences = new Map<string, number>();
  return entries.map((entry) => {
    const label = entry.label || '';
    const occurrence = occurrences.get(label) || 0;
    occurrences.set(label, occurrence + 1);
    return {
      entry: true,
      key: `${label}:${occurrence}`,
      label,
      meta: [entry.value || '', entry.detail || ''].filter(Boolean).join(' · '),
    };
  });
}

function metricByLabel(metrics: SheetMetric[], label: string): SheetMetric | undefined {
  const wanted = label.toLowerCase();
  return metrics.find((metric) => metric.label.toLowerCase() === wanted);
}

function metricText(metric: SheetMetric | undefined): string {
  return metric?.text || String(metric?.value ?? '-');
}

function ControllerValue({ controller }: { controller: SheetProjection['controller'] }) {
  if (!controller) return <>-</>;
  const kind = controller.kind ? `${controller.kind}: ` : '';
  const label = controller.name || controller.kind || 'Controller';
  const detail = [
    controller.detail || '',
    `${controller.controller_id || ''} gen ${controller.generation ?? 0}`.trim(),
  ].filter(Boolean).join(' · ');
  return <>
    <div class="stat-main"><span>{kind}{label}</span></div>
    <div class="stat-detail">{detail}</div>
  </>;
}

function PointsValue({ current, icon, iconClass, maximum, services }: {
  current: unknown;
  icon: string;
  iconClass: string;
  maximum: unknown;
  services: CharacterServices;
}) {
  return <div class="stat-main">
    <span class={`stat-icon bl-point-icon ${iconClass}`} aria-hidden="true">{icon}</span>
    <span>{services.formatPoints(current)} / {services.formatPoints(maximum)} points</span>
  </div>;
}

function Stat({ children, id, label, wide = false }: {
  children: preact.ComponentChildren;
  id: string;
  label: string;
  wide?: boolean;
}) {
  return <div class={`stat${wide ? ' stat-wide' : ''}`}>
    <div class="stat-label">{label}</div>
    <div class="stat-value" id={id}>{children}</div>
  </div>;
}

function Section({ children, id, title, populated = false }: {
  children: preact.ComponentChildren;
  id: string;
  populated?: boolean;
  title: string;
}) {
  return <div class="section">
    <div class="section-title">{title}</div>
    <div id={id} class={populated ? 'sheet-list' : 'sheet-empty'}>{children}</div>
  </div>;
}

interface CharacterFacade {
  projection: SheetProjection | null;
  refresh: () => Promise<void>;
  render: () => void;
  selectCharacter: (id: string, options?: { updateHash?: boolean }) => void;
}

export interface CharacterPageProps {
  canAdminister?: boolean;
  onViewChange?: (view: CharacterView) => void;
  services?: CharacterServices;
}

export function CharacterPage({
  canAdminister = false,
  onViewChange,
  services = DEFAULT_BROWSER_SERVICES,
}: CharacterPageProps) {
  const [apiUrl, setApiUrl] = useState('/api/v1/');
  const [apiBase, setApiBase] = useState('');
  const [connected, setConnected] = useState(false);
  const [features, setFeatures] = useState<FeatureStatus | null>(null);
  const [view, setView] = useState<CharacterView>(viewFromUrl);
  const [characters, setCharacters] = useState<SheetCharacter[]>([]);
  const [selectedId, setSelectedId] = useState(hashCharacterId);
  const [projection, setProjection] = useState<SheetProjection | null>(null);
  const [portraitState, setPortraitState] = useState('');
  const [uploadState, setUploadState] = useState('');
  const [uploadingPurpose, setUploadingPurpose] = useState('');
  const [apiStatus, setApiStatus] = useState('○ Offline');
  const [statusKind, setStatusKind] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [chatStatus, setChatStatus] = useState('Select a character to start chatting.');
  const [chatDraft, setChatDraft] = useState('');
  const [chatClientId, setChatClientId] = useState('');
  const [typingCharacterIds, setTypingCharacterIds] = useState<Set<string>>(() => new Set());
  const [llmControllers, setLlmControllers] = useState<LlmControllerOption[]>([]);
  const [selectedLlmController, setSelectedLlmController] = useState('');
  const [controllerOptionsStatus, setControllerOptionsStatus] = useState('');
  const [assigningController, setAssigningController] = useState(false);
  const [, setHistoryRevision] = useState(0);
  const [markdownEnabled, setMarkdownEnabled] = useState(() => localStorage.getItem(MARKDOWN_KEY) !== '0');
  const [rememberDevice, setRememberDevice] = useState(() => rememberOnThisDevice());
  const [, forceRender] = useState(0);
  const aliveRef = useRef(true);
  const apiBaseRef = useRef('');
  const connectedRef = useRef(false);
  const selectedIdRef = useRef(selectedId);
  const projectionRef = useRef<SheetProjection | null>(null);
  const authHeaderRef = useRef<string | null>(null);
  const chatClientIdRef = useRef('');
  const requestGeneration = useRef(0);
  const pendingPolls = useRef(new Map<string, number>());
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const portraitUploadRef = useRef<HTMLInputElement>(null);
  const spriteUploadRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  apiBaseRef.current = apiBase;
  connectedRef.current = connected;
  selectedIdRef.current = selectedId;
  projectionRef.current = projection;
  chatClientIdRef.current = chatClientId;
  const chatLifecycle = characterChatLifecycle(projection);

  const bumpHistory = useCallback((): void => setHistoryRevision((value) => value + 1), []);

  const setCharacterTyping = useCallback((characterId: string, typing: boolean): void => {
    setTypingCharacterIds((current) => {
      if (current.has(characterId) === typing) return current;
      const next = new Set(current);
      if (typing) next.add(characterId);
      else next.delete(characterId);
      return next;
    });
  }, []);

  const updateChatState = useCallback((characterId: string, update: (messages: StoredMessage[]) => StoredMessage[]): void => {
    const state = loadChatState(chatClientIdRef.current, characterId);
    state.messages = update(state.messages).slice(-HISTORY_LIMIT);
    saveChatState(chatClientIdRef.current, characterId, state);
    bumpHistory();
  }, [bumpHistory]);

  const upsertAction = useCallback((characterId: string, action: ChatAction, jobId = ''): void => {
    if (!action.tool) return;
    updateChatState(characterId, (messages) => {
      const commandId = action.command_id || '';
      const next: StoredMessage = {
        action,
        command_id: commandId,
        job_id: jobId,
        role: 'action',
        text: actionSummary(action),
      };
      const index = commandId
        ? messages.findIndex((message) => message.role === 'action' && message.command_id === commandId)
        : -1;
      if (index < 0) return [...messages, next];
      return messages.map((message, messageIndex) => messageIndex === index ? next : message);
    });
  }, [updateChatState]);

  const clearPendingPolls = useCallback((characterId?: string): void => {
    for (const [key, timer] of pendingPolls.current) {
      if (characterId && !key.startsWith(`${characterId}:`)) continue;
      window.clearTimeout(timer);
      pendingPolls.current.delete(key);
    }
  }, []);

  const startPendingPoll = useCallback((characterId: string, jobId: string, immediate = false): void => {
    const base = apiBaseRef.current;
    if (!base || !jobId) return;
    const key = `${characterId}:${jobId}`;
    if (pendingPolls.current.has(key)) return;
    setCharacterTyping(characterId, true);
    const poll = async (): Promise<void> => {
      try {
        const response = await services.sendJson(
          base,
          `/chat/characters/${encodeURIComponent(characterId)}/jobs/${encodeURIComponent(jobId)}`,
        );
        if (!aliveRef.current) return;
        const result = response.result && typeof response.result === 'object'
          ? response.result as JsonObject
          : response;
        const action = result.action && typeof result.action === 'object'
          ? result.action as ChatAction
          : null;
        if (action?.tool) upsertAction(characterId, action, jobId);
        if (response.status === 'succeeded' || response.status === 'failed') {
          pendingPolls.current.delete(key);
          setCharacterTyping(characterId, false);
          if (response.status === 'failed') {
            const failure = response.failure && typeof response.failure === 'object'
              ? response.failure as JsonObject
              : null;
            if (selectedIdRef.current === characterId) {
              setChatStatus(String(failure?.detail || 'Chat failed.'));
            }
            return;
          }
          if (result.reply) updateChatState(characterId, (messages) => (
            messages.some((message) => message.role === 'character' && message.command_id === jobId)
              ? messages
              : [...messages, { role: 'character', text: String(result.reply), command_id: jobId }]
          ));
          if (selectedIdRef.current === characterId) {
            setChatStatus(action?.tool ? `${action.tool}: ${action.status}` : 'Action finished.');
          }
          return;
        }
        if (selectedIdRef.current === characterId) setChatStatus('Waiting for action result...');
        pendingPolls.current.set(key, window.setTimeout(() => { void poll(); }, PENDING_POLL_MS));
      } catch (error) {
        pendingPolls.current.delete(key);
        setCharacterTyping(characterId, false);
        if (aliveRef.current && selectedIdRef.current === characterId) setChatStatus(errorMessage(error));
      }
    };
    pendingPolls.current.set(key, window.setTimeout(() => { void poll(); }, immediate ? 0 : PENDING_POLL_MS));
  }, [services, setCharacterTyping, updateChatState, upsertAction]);

  const refresh = useCallback(async (): Promise<void> => {
    const base = apiBaseRef.current;
    if (!connectedRef.current || !base) return;
    const selected = selectedIdRef.current;
    const generation = ++requestGeneration.current;
    try {
      const list = await services.fetchCharacterList(base);
      if (!aliveRef.current || generation !== requestGeneration.current) return;
      const nextCharacters = list.characters || [];
      setCharacters(nextCharacters);
      let nextProjection: SheetProjection | null = null;
      if (selected && nextCharacters.some((character) => character.id === selected)) {
        nextProjection = await services.fetchCharacterProfile(base, selected);
        if (!aliveRef.current || generation !== requestGeneration.current || selected !== selectedIdRef.current) return;
        setProjection(nextProjection);
        projectionRef.current = nextProjection;
        setPortraitState('');
        const chatState = loadChatState(chatClientIdRef.current, selected);
        for (const message of chatState.messages) {
          if (message.role === 'action' && message.action?.status === 'queued' && message.job_id) {
            startPendingPoll(selected, message.job_id);
          }
        }
      } else {
        setProjection(null);
        projectionRef.current = null;
      }
      setStatusKind('live');
      setApiStatus(`● Connected · epoch ${nextProjection?.worldEpoch || list.epoch || 0}`);
      setStatusNote('');
    } catch (error) {
      if (!aliveRef.current || generation !== requestGeneration.current) return;
      setStatusKind('err');
      setApiStatus(`⚠ ${errorMessage(error)}`);
      setStatusNote(errorMessage(error));
    }
  }, [services, startPendingPoll]);
  refreshRef.current = refresh;

  const selectCharacter = useCallback((id: string, options: { updateHash?: boolean } = {}): void => {
    requestGeneration.current += 1;
    setCharacterTyping(selectedIdRef.current, false);
    clearPendingPolls(selectedIdRef.current);
    const next = id || '';
    selectedIdRef.current = next;
    projectionRef.current = null;
    setSelectedId(next);
    setProjection(null);
    setPortraitState('');
    setUploadState('');
    setUploadingPurpose('');
    setChatDraft('');
    setChatStatus(next ? 'Loading character…' : 'Select a character to start chatting.');
    if (options.updateHash) {
      const url = new URL(location.href);
      url.hash = next ? encodeURIComponent(next) : '';
      history.replaceState(null, '', url);
    }
  }, [clearPendingPolls, setCharacterTyping]);

  const disconnect = useCallback((syncUrl = true): void => {
    requestGeneration.current += 1;
    clearPendingPolls();
    connectedRef.current = false;
    apiBaseRef.current = '';
    setConnected(false);
    setFeatures(null);
    setApiBase('');
    setCharacters([]);
    setProjection(null);
    projectionRef.current = null;
    setPortraitState('');
    setUploadState('');
    setUploadingPurpose('');
    setStatusKind('');
    setApiStatus('○ Offline');
    setStatusNote('');
    setChatStatus('Select a character to start chatting.');
    setTypingCharacterIds(new Set());
    if (syncUrl) services.setServerInUrl('');
  }, [clearPendingPolls, services]);

  const connect = useCallback((url: string): void => {
    if (!url) return;
    const base = services.normalizeBase(url);
    if (!base) return;
    requestGeneration.current += 1;
    apiBaseRef.current = base;
    connectedRef.current = true;
    setApiUrl(base);
    setApiBase(base);
    setConnected(true);
    setFeatures(null);
    setCharacters([]);
    setProjection(null);
    projectionRef.current = null;
    setPortraitState('');
    setUploadState('');
    setUploadingPurpose('');
    setStatusKind('live');
    setApiStatus('● Connected');
    setStatusNote('');
    services.setServerInUrl(base);
    void services.sendJson(base, '/public/features').then((response) => {
      if (!aliveRef.current || apiBaseRef.current !== base) return;
      const nextFeatures = response as FeatureStatus;
      setFeatures(nextFeatures);
      setView((current) => {
        const next = current === 'chat' && !nextFeatures.character_chat && nextFeatures.character_sheets
          ? 'sheet'
          : current === 'sheet' && !nextFeatures.character_sheets && nextFeatures.character_chat
            ? 'chat'
            : current;
        if (next !== current) history.replaceState(null, '', characterViewUrl(location.href, next));
        if (next !== current) onViewChange?.(next);
        return next;
      });
    }).catch((error) => {
      if (!aliveRef.current || apiBaseRef.current !== base) return;
      setStatusKind('err');
      setApiStatus(`⚠ ${errorMessage(error)}`);
    });
  }, [onViewChange, services]);

  const selectView = useCallback((next: CharacterView): void => {
    if (next === 'chat' && features?.character_chat === false) return;
    if (next === 'sheet' && features?.character_sheets === false) return;
    setView(next);
    onViewChange?.(next);
    history.replaceState(null, '', characterViewUrl(location.href, next));
  }, [features, onViewChange]);

  useEffect(() => {
    if (!connected || !apiBase) return;
    void refreshRef.current();
    const timer = window.setInterval(() => { void refreshRef.current(); }, LOBBY_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [apiBase, connected, selectedId]);

  useEffect(() => {
    const lifecycleUnavailable = characterChatLifecycleUnavailable(
      chatLifecycle,
      features?.allow_sleeping_character_chat === true,
    );
    if (!canAdminister || !connected || !apiBase || !selectedId || !projection?.characterId
      || projection.controller?.kind === 'llm' || lifecycleUnavailable) {
      setLlmControllers([]);
      setSelectedLlmController('');
      setControllerOptionsStatus('');
      return;
    }
    let cancelled = false;
    setControllerOptionsStatus('Loading LLM controllers…');
    void services.fetchLlmControllers(apiBase).then((options) => {
      if (cancelled) return;
      setLlmControllers(options);
      const defaultController = options.find((option) => option.label.trim().toLowerCase() === 'default');
      setSelectedLlmController(defaultController?.id || options[0]?.id || '');
      setControllerOptionsStatus(options.length ? '' : 'No LLM controllers are available to assign.');
    }).catch((error) => {
      if (cancelled) return;
      setLlmControllers([]);
      setSelectedLlmController('');
      setControllerOptionsStatus(`Could not load LLM controllers: ${errorMessage(error)}`);
    });
    return () => { cancelled = true; };
  }, [apiBase, canAdminister, chatLifecycle, connected, features?.allow_sleeping_character_chat, projection?.characterId, projection?.controller?.kind, selectedId, services]);

  useEffect(() => {
    aliveRef.current = true;
    services.initTheme();
    const menu = services.initClientMenu();
    const nextClientId = services.persistentClientId(CHAT_CLIENT_ID_KEY, 'character-chat');
    chatClientIdRef.current = nextClientId;
    setChatClientId(nextClientId);
    const onHashChange = (): void => {
      const id = hashCharacterId();
      if (id !== selectedIdRef.current) selectCharacter(id);
    };
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
      clearPendingPolls();
      window.removeEventListener('hashchange', onHashChange);
      menu?.close?.();
    };
  }, [clearPendingPolls, connect, selectCharacter, services]);

  useEffect(() => {
    const titleName = projection?.characterName
      || characters.find((character) => character.id === selectedId)?.name
      || '';
    document.title = titleName ? `${DOCUMENT_TITLE_BASE}: ${titleName}` : DOCUMENT_TITLE_BASE;
  });

  useEffect(() => {
    const compatWindow = window as unknown as { app?: CharacterFacade };
    const facade: CharacterFacade = {
      get projection() { return projectionRef.current; },
      refresh: () => refreshRef.current(),
      render: () => forceRender((value) => value + 1),
      selectCharacter,
    };
    compatWindow.app = facade;
    return () => {
      if (compatWindow.app === facade) delete compatWindow.app;
    };
  }, [selectCharacter]);

  const uploadImage = async (purpose: 'portrait' | 'sprite'): Promise<void> => {
    if (!connected || !apiBase || !selectedId) {
      setUploadState('Select a character before uploading.');
      return;
    }
    const input = purpose === 'portrait' ? portraitUploadRef.current : spriteUploadRef.current;
    const file = input?.files?.[0] || null;
    if (!file) {
      setUploadState(`Choose a ${purpose} image first.`);
      return;
    }
    const selected = selectedId;
    setUploadingPurpose(purpose);
    setUploadState(`Uploading ${purpose}...`);
    try {
      const result = await services.uploadCharacterImage(apiBase, selected, purpose, file, {
        getAuth: () => authHeaderRef.current,
        setAuth: (auth) => { authHeaderRef.current = auth; },
      });
      if (!aliveRef.current || selected !== selectedIdRef.current) return;
      if (input) input.value = '';
      setUploadState(`${purpose === 'portrait' ? 'Portrait' : 'Sprite'} uploaded.`);
      if (purpose === 'portrait') {
        setPortraitState('');
      }
      setUploadingPurpose('');
      await refreshRef.current();
      if (result.url && aliveRef.current) {
        setUploadState(`${purpose === 'portrait' ? 'Portrait' : 'Sprite'} uploaded.`);
      }
    } catch (error) {
      if (!aliveRef.current || selected !== selectedIdRef.current) return;
      setUploadingPurpose('');
      setUploadState(`Upload failed: ${errorMessage(error)}`);
    }
  };

  const sortedCharacters = useMemo(
    () => [...characters].sort((a, b) => a.name.localeCompare(b.name)),
    [characters],
  );
  const characterName = projection?.characterName
    || characters.find((character) => character.id === selectedId)?.name
    || selectedId;
  const portraitUrl = projection?.portrait?.url && apiBase
    ? services.mediaUrl(apiBase, projection.portrait.url)
    : '';
  const sheet = projection?.sheet || {};
  const vitals = sheet.vitals || [];
  const initiative = metricByLabel(vitals, 'Initiative');
  const room = projection?.room || {};
  const points = projection?.points || {};
  const uploadDisabled = !connected || !apiBase || !selectedId || Boolean(uploadingPurpose);
  const selectedChatState = selectedId && chatClientId
    ? loadChatState(chatClientId, selectedId)
    : { summary: '', messages: [] };
  const hasChatHistory = Boolean(selectedChatState.summary || selectedChatState.messages.length);
  const chatTyping = typingCharacterIds.has(selectedId);
  const transcriptItems = useMemo<TranscriptItem[]>(() => {
    const occurrences = new Map<string, number>();
    return selectedChatState.messages.map((message) => {
      const action = message.action || {};
      const baseKey = message.command_id
        ? `${message.role}:${message.command_id}`
        : `${message.role}:${message.text}:${action.tool || ''}`;
      const occurrence = occurrences.get(baseKey) || 0;
      occurrences.set(baseKey, occurrence + 1);
      const key = `${baseKey}:${occurrence}`;
      if (message.role === 'action') return {
        commandId: message.command_id || '',
        icon: services.actionIcon({
          command_type: String(action.tool || 'action').trim().toLowerCase().replaceAll('_', '-'),
          tool_name: action.tool || 'action',
        }),
        key,
        kind: 'action',
        status: String(action.status || '').replace(/[^a-z0-9_-]/gi, '').toLowerCase(),
        text: message.text || actionSummary(action),
        tool: action.tool || 'action',
      };
      return {
        html: markdownEnabled ? renderMarkdown(message.text) : plainMessageHtml(message.text),
        key,
        kind: 'message',
        plain: !markdownEnabled,
        role: message.role === 'user' ? 'user' : 'character',
      };
    });
  }, [markdownEnabled, selectedChatState.messages, services]);

  useLayoutEffect(() => {
    if (view === 'chat' && transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [chatTyping, transcriptItems, view]);

  const submitChat = async (): Promise<void> => {
    const message = chatDraft.trim();
    const characterId = selectedIdRef.current;
    const base = apiBaseRef.current;
    const lifecycleUnavailable = characterChatLifecycleUnavailable(
      characterChatLifecycle(projectionRef.current),
      features?.allow_sleeping_character_chat === true,
    );
    if (!message || !base || !characterId || projectionRef.current?.controller?.kind !== 'llm'
      || lifecycleUnavailable) return;
    const state = loadChatState(chatClientIdRef.current, characterId);
    setChatDraft('');
    updateChatState(characterId, (messages) => [...messages, { role: 'user', text: message }]);
    setCharacterTyping(characterId, true);
    setChatStatus('Waiting for reply…');
    try {
      const job = await services.sendJson(base, `/chat/characters/${encodeURIComponent(characterId)}/jobs`, {
        body: JSON.stringify({
          kind: 'chat',
          message,
          history_summary: state.summary || '',
          history: historyForPayload(state.messages),
        }),
        method: 'POST',
      });
      const result = job.result && typeof job.result === 'object' ? job.result as JsonObject : job;
      if (!aliveRef.current) return;
      const jobId = String(job.id || '');
      if (result.reply && jobId) {
        updateChatState(characterId, (messages) => [
          ...messages,
          { role: 'character', text: String(result.reply), command_id: jobId },
        ]);
      }
      const action = result.action && typeof result.action === 'object' ? result.action as ChatAction : null;
      if (action?.tool) upsertAction(characterId, action, jobId);
      if (job.status === 'queued' || job.status === 'running' || action?.status === 'queued') {
        if (jobId) startPendingPoll(characterId, jobId);
        setChatStatus(result.reply ? 'Waiting for action result...' : 'Chat queued. Waiting for reply…');
      } else if (job.status === 'failed') {
        setCharacterTyping(characterId, false);
        const failure = job.failure && typeof job.failure === 'object'
          ? job.failure as JsonObject
          : null;
        setChatStatus(String(failure?.detail || 'Chat failed.'));
      } else {
        setCharacterTyping(characterId, false);
        setChatStatus(action?.tool
          ? `${action.tool}: ${action.status}${action.reason ? ` · ${action.reason}` : ''}`
          : 'Reply received.');
      }
    } catch (error) {
      if (!aliveRef.current) return;
      setCharacterTyping(characterId, false);
      setChatStatus(errorMessage(error));
      setStatusKind('err');
      setApiStatus(`⚠ ${errorMessage(error)}`);
    }
  };

  const assignLlmController = async (): Promise<void> => {
    const base = apiBaseRef.current;
    const characterId = selectedIdRef.current;
    const defaultController = llmControllers.find(
      (controller) => controller.label.trim().toLowerCase() === 'default',
    );
    const controllerId = chatLifecycle === 'suspended'
      ? defaultController?.id || ''
      : selectedLlmController;
    if (!canAdminister || !base || !characterId || !controllerId || assigningController) return;
    setAssigningController(true);
    setChatStatus(chatLifecycle === 'suspended'
      ? 'Activating character on the default LLM controller…'
      : 'Assigning LLM controller…');
    try {
      await services.assignController(base, characterId, controllerId);
      if (!aliveRef.current || characterId !== selectedIdRef.current) return;
      await refreshRef.current();
      if (aliveRef.current && characterId === selectedIdRef.current) {
        setChatStatus(chatLifecycle === 'suspended'
          ? `${characterName || characterId} activated on the default LLM controller.`
          : `LLM controller assigned to ${characterName || characterId}.`);
      }
    } catch (error) {
      if (aliveRef.current && characterId === selectedIdRef.current) {
        setChatStatus(`Could not assign LLM controller: ${errorMessage(error)}`);
      }
    } finally {
      if (aliveRef.current) setAssigningController(false);
    }
  };

  const chatControllerReady = projection?.controller?.kind === 'llm';
  const lifecycleUnavailable = characterChatLifecycleUnavailable(
    chatLifecycle,
    features?.allow_sleeping_character_chat === true,
  );
  const chatReadOnly = Boolean(selectedId && projection && !chatControllerReady && !lifecycleUnavailable);
  const chatUnavailable = !connected || !selectedId || features?.character_chat === false
    || lifecycleUnavailable;
  const lifecycleUnavailableReason = chatLifecycle === 'dead'
    ? `${characterName || selectedId} is dead and is not available to chat.`
    : chatLifecycle === 'downed'
      ? `${characterName || selectedId} is unconscious and is not available to chat.`
      : chatLifecycle === 'sleeping'
        ? `${characterName || selectedId} is sleeping and cannot be interrupted by chat.`
        : '';

  return <>
    <Toolbar id="toolbar">
      <ToolbarRow class="toolbar-heading" id="toolbar-row1">
        <ToolbarBrand icon={<img src="favicon.png" alt="" />}>Bunnyland Character</ToolbarBrand>
        <Button id="btn-client-menu" class="client-menu-button">Menu</Button>
      </ToolbarRow>
      <ToolbarRow id="toolbar-row2">
        <label for="api-url">Server:</label>
        <input
          id="api-url"
          onInput={(event): void => setApiUrl(event.currentTarget.value)}
          spellcheck={false}
          type="text"
          value={apiUrl}
        />
        <Button id="btn-connect" onClick={(): void => {
          if (connected) disconnect();
          else connect(apiUrl.trim());
        }}>{connected ? 'Disconnect' : 'Connect Live'}</Button>
        <StatusText
          class={statusKind}
          id="api-status"
          tone={statusKind === 'live' ? 'ok' : statusKind === 'err' ? 'error' : 'muted'}
        >{apiStatus}</StatusText>
      </ToolbarRow>
      <ToolbarRow id="toolbar-row3">
        <label for="character-select">Character:</label>
        <select
          id="character-select"
          onChange={(event): void => selectCharacter(event.currentTarget.value, { updateHash: true })}
          value={sortedCharacters.some((character) => character.id === selectedId) ? selectedId : ''}
        >
          <option value="">— choose a character —</option>
          {sortedCharacters.map((character) => (
            <option key={character.id} value={character.id}>{character.name}</option>
          ))}
        </select>
        <div class="view-tabs" role="tablist" aria-label="Character view">
          <Button
            aria-selected={view === 'sheet'}
            class={view === 'sheet' ? 'active' : ''}
            disabled={features?.character_sheets === false}
            id="tab-sheet"
            onClick={(): void => selectView('sheet')}
            role="tab"
          >Sheet</Button>
          <Button
            aria-label={hasChatHistory ? 'Chat, history available' : 'Chat'}
            aria-selected={view === 'chat'}
            class={view === 'chat' ? 'active' : ''}
            disabled={features?.character_chat === false}
            id="tab-chat"
            onClick={(): void => selectView('chat')}
            role="tab"
          >Chat{hasChatHistory && <span aria-hidden="true" class="chat-history-marker" />}</Button>
        </div>
      </ToolbarRow>
    </Toolbar>

    <main id="main" class={`app-grid character-${view}-view`}>
      <section id="identity-pane" aria-label="Character identity">
        <div class="portrait-frame" id="portrait-frame">
          {portraitUrl
            ? <img src={portraitUrl} alt={`${characterName} portrait`} />
            : <div class="portrait-placeholder" data-testid="portrait-placeholder">{characterInitials(characterName)}</div>}
        </div>
        <div id="portrait-status" class={portraitState === 'failed' ? 'failed' : ''}>
          {selectedId ? services.portraitStatusMessage(projection, portraitState) : ''}
        </div>
        <div class="upload-panel" id="image-upload-panel">
          <div class="upload-row">
            <label for="portrait-upload">Portrait</label>
            <input id="portrait-upload" ref={portraitUploadRef} type="file" accept="image/png,image/jpeg,image/webp" />
            <Button
              disabled={uploadDisabled || uploadingPurpose === 'sprite'}
              id="btn-upload-portrait"
              onClick={(): void => { void uploadImage('portrait'); }}
            >{uploadingPurpose === 'portrait' ? 'Uploading' : 'Upload'}</Button>
          </div>
          <div class="upload-row">
            <label for="sprite-upload">Sprite</label>
            <input id="sprite-upload" ref={spriteUploadRef} type="file" accept="image/png,image/jpeg,image/webp" />
            <Button
              disabled={uploadDisabled || uploadingPurpose === 'portrait'}
              id="btn-upload-sprite"
              onClick={(): void => { void uploadImage('sprite'); }}
            >{uploadingPurpose === 'sprite' ? 'Uploading' : 'Upload'}</Button>
          </div>
          <div id="image-upload-status" class={uploadState.startsWith('Upload failed') ? 'failed' : ''}>{uploadState}</div>
        </div>
        <h1 id="character-name">{characterName || 'No character selected'}</h1>
        <div id="character-id">{selectedId || 'Connect to a server, then choose a character.'}</div>
        <div id="status-pills" class="pill-row"><PillList emptyMessage="" values={projection ? sheet.status || [] : []} /></div>
        <div class="identity-grid">
          <Stat id="kind-value" label="Kind">{sheet.kind || '-'}</Stat>
          <Stat id="species-value" label="Species">{sheet.species || '-'}</Stat>
          <Stat id="controller-value" label="Controller" wide><ControllerValue controller={projection?.controller || null} /></Stat>
          <Stat id="room-value" label="Room">{room.title || room.id || '-'}</Stat>
          <Stat id="initiative-value" label="Initiative">{projection ? metricText(initiative) : '-'}</Stat>
          <Stat id="ap-value" label="Action Points">{projection
            ? <PointsValue current={points.action} icon="⚡" iconClass="bl-point-icon-action" maximum={points.action_max} services={services} />
            : '-'}</Stat>
          <Stat id="fp-value" label="Focus Points">{projection
            ? <PointsValue current={points.focus} icon="✦" iconClass="bl-point-icon-focus" maximum={points.focus_max} services={services} />
            : '-'}</Stat>
        </div>
      </section>

      <section id="details-pane" aria-label={view === 'sheet' ? 'Character details' : 'Character chat'}>
        {view === 'sheet' ? <>
        <Section id="sheet-overview" title="Character" populated={Boolean(
          sheet.description || sheet.appearance || sheet.biography || sheet.tags?.length
        )}>
          <Overview emptyMessage="No character notes." overview={sheet} />
        </Section>
        <div class="section-grid">
          <Section id="vitals" title="Vitals" populated={vitals.length > 1}>
            <MetricList emptyMessage="No vitals recorded." metrics={vitals.filter((metric) => metric !== initiative)} />
          </Section>
          <Section id="needs" title="Needs" populated={Boolean(sheet.needs?.length)}>
            <MetricList emptyMessage="No needs recorded." metrics={sheet.needs || []} />
          </Section>
          <Section id="affect" title="Mood" populated={Boolean(sheet.affect?.length)}>
            <MetricList emptyMessage="No mood values recorded." metrics={sheet.affect || []} />
          </Section>
          <Section id="profile" title="Profile" populated={Boolean(sheet.profile?.length)}>
            <SheetList emptyMessage="No profile entries." rows={entryRows(sheet.profile)} />
          </Section>
          <Section id="skills" title="Skills" populated={Boolean(sheet.skills?.length)}>
            <SheetList emptyMessage="No skills recorded." rows={entryRows(sheet.skills)} />
          </Section>
          <Section id="traits" title="Traits" populated={Boolean(sheet.traits?.length)}>
            <PillList emptyMessage="No traits recorded." values={sheet.traits || []} />
          </Section>
          <Section id="relations" title="Relations" populated={Boolean(sheet.relations?.length)}>
            <SheetList emptyMessage="No relations recorded." rows={entryRows(sheet.relations)} />
          </Section>
          <Section id="injuries" title="Injuries" populated={Boolean(sheet.injuries?.length)}>
            <SheetList emptyMessage="No injuries recorded." rows={entryRows(sheet.injuries)} />
          </Section>
        </div>
        <Section id="notes" title="Notes" populated={Boolean(sheet.notes?.length)}>
          <SheetList emptyMessage="No notes recorded." rows={entryRows(sheet.notes)} />
        </Section>
        <div id="status-note">{statusNote}</div>
        </> : <div id="chat-pane">
          <div id="chat-tools">
            <span id="chat-title">{characterName || 'No character selected'}</span>
            <div id="chat-actions">
              <label class="chat-toggle" for="markdown-toggle">
                <input
                  checked={markdownEnabled}
                  id="markdown-toggle"
                  onChange={(event): void => {
                    const enabled = event.currentTarget.checked;
                    setMarkdownEnabled(enabled);
                    localStorage.setItem(MARKDOWN_KEY, enabled ? '1' : '0');
                  }}
                  type="checkbox"
                /> Markdown
              </label>
              <label class="chat-toggle" for="remember-device-toggle">
                <input
                  checked={rememberDevice}
                  id="remember-device-toggle"
                  onChange={(event): void => {
                    const remember = event.currentTarget.checked;
                    setRememberDevice(remember);
                    // Turning this off stops persisting transcripts and clears any already
                    // cached narrative on this device.
                    setRememberOnThisDevice(remember);
                    if (!remember) {
                      bumpHistory();
                    }
                  }}
                  type="checkbox"
                /> Remember on this device
              </label>
              <Button
                disabled={!selectedId || !hasChatHistory}
                id="btn-clear-history"
                onClick={(): void => {
                  if (!selectedId) return;
                  setCharacterTyping(selectedId, false);
                  clearPendingPolls(selectedId);
                  localStorage.removeItem(chatStorageKey(chatClientId, selectedId));
                  bumpHistory();
                  setChatStatus(`Cleared local chat history for ${characterName || selectedId}.`);
                }}
              >Clear History</Button>
            </div>
          </div>
          <div id="transcript" ref={transcriptRef}>
            <Transcript
              emptyMessage={selectedId
                ? 'No local chat history for this character.'
                : 'Pick a character to start chatting.'}
              items={transcriptItems}
            />
            {chatTyping && <div
              aria-label={`${characterName || selectedId} is typing`}
              class="typing-indicator"
              role="status"
            >
              <span aria-hidden="true" class="typing-indicator-dot" />
              <span aria-hidden="true" class="typing-indicator-dot" />
              <span aria-hidden="true" class="typing-indicator-dot" />
            </div>}
          </div>
          {(chatReadOnly || lifecycleUnavailable) && <div id="chat-read-only" role="status">
            <span>
              {lifecycleUnavailableReason || `Chat is read-only because ${characterName || selectedId} is not assigned to an LLM controller.`}
            </span>
            {canAdminister && !lifecycleUnavailable && <div id="llm-controller-assignment">
              {llmControllers.length > 0 && <>
                <label for="llm-controller-select">LLM controller</label>
                <select
                  disabled={assigningController}
                  id="llm-controller-select"
                  onChange={(event): void => setSelectedLlmController(event.currentTarget.value)}
                  value={selectedLlmController}
                >
                  {llmControllers.map((controller) => <option key={controller.id} value={controller.id}>
                    {controller.label}{controller.detail ? ` · ${controller.detail}` : ''}
                  </option>)}
                </select>
                <Button
                  disabled={!selectedLlmController || assigningController}
                  id="btn-assign-llm-controller"
                  onClick={(): void => { void assignLlmController(); }}
                >{assigningController
                    ? (chatLifecycle === 'suspended' ? 'Activating…' : 'Assigning…')
                    : (chatLifecycle === 'suspended' ? 'Activate with default LLM' : 'Assign LLM Controller')}
                </Button>
              </>}
              {controllerOptionsStatus && <StatusText tone={controllerOptionsStatus.startsWith('Could not') ? 'error' : 'muted'}>
                {controllerOptionsStatus}
              </StatusText>}
            </div>}
          </div>}
          <div id="status-line">{chatStatus}</div>
          <form
            autocomplete="off"
            id="composer"
            onSubmit={(event): void => { event.preventDefault(); void submitChat(); }}
          >
            <textarea
              aria-label="Message"
              aria-describedby={chatReadOnly ? 'chat-read-only' : undefined}
              disabled={chatUnavailable}
              id="chat-input"
              onInput={(event): void => setChatDraft(event.currentTarget.value)}
              onKeyDown={(event): void => {
                if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
              spellcheck
              readOnly={chatReadOnly}
              value={chatDraft}
            />
            <Button
              disabled={!chatDraft.trim() || chatUnavailable || !chatControllerReady || chatTyping}
              id="btn-send"
              type="submit"
            >Send</Button>
          </form>
        </div>}
      </section>
    </main>
  </>;
}

const root = document.getElementById('app');
if (root) {
  const base = DEFAULT_BROWSER_SERVICES.serverFromUrl() || '/api/v1';
  function CharacterEntry() {
    const [scope, setScope] = useState(viewFromUrl() === 'chat' ? 'character:chat' as const : 'character:profile' as const);
    const selectScope = useCallback((view: CharacterView): void => {
      setScope(view === 'chat' ? 'character:chat' : 'character:profile');
    }, []);
    const auth = useAuth();
    useEffect((): void => {
      // Clear cached narrative when the session ends so it does not linger for the next
      // user of a shared device.
      if (auth.status === 'anonymous') {
        clearRememberedNarrative();
      }
    }, [auth.status]);
    return (
      <AuthGate scopes={[scope]}>
        <CharacterPage canAdminister={auth.hasScopes(['world:admin'])} onViewChange={selectScope} />
      </AuthGate>
    );
  }
  render(<AuthProvider base={base}><CharacterEntry /></AuthProvider>, root);
}
