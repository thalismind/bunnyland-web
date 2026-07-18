import {
  Button,
  StatusText,
  Toolbar,
  ToolbarBrand,
  ToolbarRow,
} from '@bunnyland/ui-web/preact';
import { render } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { MetricList, type SheetMetric } from './metrics';
import { Overview, PillList, SheetList, type OverviewContent, type SheetRow } from './sections';

const DOCUMENT_TITLE_BASE = 'Bunnyland Character Sheet';
const LOBBY_POLL_INTERVAL_MS = 2000;
const CLAIM_CLIENT_KEYS = [
  'bunnyland.webTui.clientId',
  'bunnyland.webRepl.clientId',
  'bunnyland.toon.clientId',
  'bunnyland.3d',
];

export interface SheetCharacter {
  id: string;
  kind: string;
  name: string;
}

export interface SheetEntry {
  detail?: string;
  label?: string;
  value?: string;
}

export interface SheetAction {
  available?: boolean;
  command_type?: string;
  cost?: { action?: number; focus?: number };
  lane?: string;
  title?: string;
  tool_name?: string;
  unavailable_reason?: string;
}

interface SheetEntity {
  id: string;
  isCharacter?: boolean;
  kind?: string;
  name?: string;
}

export interface SheetProjection {
  actions: SheetAction[];
  characterId: string;
  characterName: string;
  controller: {
    controller_id?: string;
    detail?: string;
    generation?: number;
    kind?: string;
    name?: string;
  } | null;
  inventory: Array<{ id: string; kind?: string; label?: string; name?: string }>;
  points: Record<string, number>;
  portrait?: { url?: string };
  room: { entities?: SheetEntity[]; id?: string; title?: string };
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

interface ClaimControl {
  claimId?: string;
  claimSecret?: string;
}

interface LiveUpdates {
  close: () => void;
}

interface LiveOptions {
  base: string;
  characterId: string;
  control: ClaimControl | null;
  onState: (state: string) => void;
  refresh: () => void | Promise<void>;
}

interface UploadOptions {
  getAuth: () => string | null;
  setAuth: (auth: string | null) => void;
}

export interface CharacterSheetServices {
  actionAvailable: (action: SheetAction) => boolean;
  actionCost: (action: SheetAction) => { action: number; focus: number };
  actionLane: (action: SheetAction) => string;
  actionTitle: (action: SheetAction) => string;
  applyConfig: (options: {
    connect: (server: string) => void;
    isConnected: () => boolean;
  }) => Promise<unknown>;
  createPlayerLiveUpdates: (options: LiveOptions) => LiveUpdates;
  fetchCharacterList: (base: string) => Promise<{ characters?: SheetCharacter[]; epoch?: number }>;
  fetchCharacterProjection: (
    base: string, characterId: string, control: ClaimControl | null,
  ) => Promise<SheetProjection>;
  formatPoints: (value: unknown) => string;
  initClientMenu: () => { close?: () => void } | void;
  mediaUrl: (base: string, url: string) => string;
  normalizeBase: (url: string) => string;
  orderActionsByAvailability: (actions: SheetAction[]) => SheetAction[];
  portraitStatusMessage: (projection: SheetProjection | null, state: string) => string;
  requestSceneImage: (
    base: string, characterId: string, control: ClaimControl | null,
  ) => Promise<{ ok?: boolean }>;
  serverFromUrl: () => string;
  setServerInUrl: (base: string) => void;
  storedClaimControl: (key: string, characterId: string) => ClaimControl | null;
  uploadCharacterImage: (
    base: string, characterId: string, purpose: string, file: File, options: UploadOptions,
  ) => Promise<{ url?: string }>;
}

interface LegacyWindow extends Window {
  BunnylandApi: {
    applyConfigToInput: CharacterSheetServices['applyConfig'];
    mediaUrl: CharacterSheetServices['mediaUrl'];
    normalizeBase: CharacterSheetServices['normalizeBase'];
    requestSceneImage: CharacterSheetServices['requestSceneImage'];
    serverFromUrl: CharacterSheetServices['serverFromUrl'];
    setServerInUrl: CharacterSheetServices['setServerInUrl'];
    uploadCharacterImage: CharacterSheetServices['uploadCharacterImage'];
  };
  BunnylandPlay: Pick<CharacterSheetServices,
    'actionAvailable' | 'actionCost' | 'actionLane' | 'actionTitle' |
    'createPlayerLiveUpdates' | 'fetchCharacterList' | 'fetchCharacterProjection' |
    'formatPoints' | 'orderActionsByAvailability' | 'portraitStatusMessage' | 'storedClaimControl'>;
  BunnylandUI: { initClientMenu: CharacterSheetServices['initClientMenu'] };
}

function browserServices(): CharacterSheetServices {
  const legacy = window as unknown as LegacyWindow;
  return {
    ...legacy.BunnylandPlay,
    applyConfig: (options) => legacy.BunnylandApi.applyConfigToInput(options),
    initClientMenu: () => legacy.BunnylandUI.initClientMenu(),
    mediaUrl: (base, url) => legacy.BunnylandApi.mediaUrl(base, url),
    normalizeBase: (url) => legacy.BunnylandApi.normalizeBase(url),
    requestSceneImage: (base, id, control) => legacy.BunnylandApi.requestSceneImage(base, id, control),
    serverFromUrl: () => legacy.BunnylandApi.serverFromUrl(),
    setServerInUrl: (base) => legacy.BunnylandApi.setServerInUrl(base),
    uploadCharacterImage: (base, id, purpose, file, options) => (
      legacy.BunnylandApi.uploadCharacterImage(base, id, purpose, file, options)
    ),
  };
}

const DEFAULT_BROWSER_SERVICES = browserServices();

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
  services: CharacterSheetServices;
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

interface SheetFacade {
  projection: SheetProjection | null;
  refresh: () => Promise<void>;
  render: () => void;
  selectCharacter: (id: string, options?: { updateHash?: boolean }) => void;
}

export interface CharacterSheetPageProps {
  services?: CharacterSheetServices;
}

export function CharacterSheetPage({ services = DEFAULT_BROWSER_SERVICES }: CharacterSheetPageProps) {
  const [apiUrl, setApiUrl] = useState('/api/v1/');
  const [apiBase, setApiBase] = useState('');
  const [connected, setConnected] = useState(false);
  const [characters, setCharacters] = useState<SheetCharacter[]>([]);
  const [selectedId, setSelectedId] = useState(hashCharacterId);
  const [projection, setProjection] = useState<SheetProjection | null>(null);
  const [portraitState, setPortraitState] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [uploadState, setUploadState] = useState('');
  const [uploadingPurpose, setUploadingPurpose] = useState('');
  const [apiStatus, setApiStatus] = useState('○ Offline');
  const [statusKind, setStatusKind] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [coordinatorVersion, setCoordinatorVersion] = useState(0);
  const [, forceRender] = useState(0);
  const aliveRef = useRef(true);
  const apiBaseRef = useRef('');
  const connectedRef = useRef(false);
  const selectedIdRef = useRef(selectedId);
  const projectionRef = useRef<SheetProjection | null>(null);
  const authHeaderRef = useRef<string | null>(null);
  const requestGeneration = useRef(0);
  const requestedPortraits = useRef(new Set<string>());
  const failedPortraits = useRef(new Set<string>());
  const liveStateRef = useRef('fallback');
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const actionFilterRef = useRef<HTMLInputElement>(null);
  const portraitUploadRef = useRef<HTMLInputElement>(null);
  const spriteUploadRef = useRef<HTMLInputElement>(null);

  apiBaseRef.current = apiBase;
  connectedRef.current = connected;
  selectedIdRef.current = selectedId;
  projectionRef.current = projection;

  const claimControl = useCallback((characterId: string): ClaimControl | null => {
    for (const key of CLAIM_CLIENT_KEYS) {
      const control = services.storedClaimControl(key, characterId);
      if (control) return control;
    }
    return null;
  }, [services]);

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
        nextProjection = await services.fetchCharacterProjection(base, selected, claimControl(selected));
        if (!aliveRef.current || generation !== requestGeneration.current || selected !== selectedIdRef.current) return;
        setProjection(nextProjection);
        projectionRef.current = nextProjection;
        if (nextProjection.portrait?.url) {
          setPortraitState('');
        } else if (failedPortraits.current.has(selected)) {
          setPortraitState('failed');
        } else if (requestedPortraits.current.has(selected)) {
          setPortraitState('queued');
        } else {
          requestedPortraits.current.add(selected);
          setPortraitState('requesting');
          void services.requestSceneImage(base, selected, claimControl(selected)).then((result) => {
            if (!aliveRef.current || selected !== selectedIdRef.current) return;
            setPortraitState(result.ok === false ? 'failed' : 'queued');
            if (result.ok === false) failedPortraits.current.add(selected);
          }).catch(() => {
            if (!aliveRef.current || selected !== selectedIdRef.current) return;
            failedPortraits.current.add(selected);
            setPortraitState('failed');
          });
        }
      } else {
        setProjection(null);
        projectionRef.current = null;
      }
      if (!selected || liveStateRef.current === 'live') {
        setStatusKind('live');
        setApiStatus(`● Live · epoch ${nextProjection?.worldEpoch || list.epoch || 0}s`);
      }
      setStatusNote('');
    } catch (error) {
      if (!aliveRef.current || generation !== requestGeneration.current) return;
      setStatusKind('err');
      setApiStatus(`⚠ ${errorMessage(error)}`);
      setStatusNote(errorMessage(error));
    }
  }, [claimControl, services]);
  refreshRef.current = refresh;

  const selectCharacter = useCallback((id: string, options: { updateHash?: boolean } = {}): void => {
    requestGeneration.current += 1;
    const next = id || '';
    selectedIdRef.current = next;
    projectionRef.current = null;
    setSelectedId(next);
    setProjection(null);
    setPortraitState('');
    setUploadState('');
    setUploadingPurpose('');
    if (options.updateHash) {
      const url = new URL(location.href);
      url.hash = next ? encodeURIComponent(next) : '';
      history.replaceState(null, '', url);
    }
  }, []);

  const disconnect = useCallback((syncUrl = true): void => {
    requestGeneration.current += 1;
    connectedRef.current = false;
    apiBaseRef.current = '';
    setConnected(false);
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
    if (syncUrl) services.setServerInUrl('');
  }, [services]);

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
  }, [services]);

  useEffect(() => {
    if (!connected || !apiBase) return;
    if (!selectedId) {
      void refreshRef.current();
      const timer = window.setInterval(() => { void refreshRef.current(); }, LOBBY_POLL_INTERVAL_MS);
      return () => window.clearInterval(timer);
    }
    const live = services.createPlayerLiveUpdates({
      base: apiBase,
      characterId: selectedId,
      control: claimControl(selectedId),
      refresh: () => refreshRef.current(),
      onState: (state) => {
        if (!aliveRef.current) return;
        liveStateRef.current = state;
        if (state === 'live') {
          setStatusKind('live');
          setApiStatus('● Live');
        } else if (state !== 'closed') {
          setStatusKind('err');
          setApiStatus('◌ Reconnecting · polling');
        }
      },
    });
    return () => live.close();
  }, [apiBase, claimControl, connected, coordinatorVersion, selectedId, services]);

  useEffect(() => {
    aliveRef.current = true;
    const menu = services.initClientMenu();
    const onHashChange = (): void => {
      const id = hashCharacterId();
      if (id !== selectedIdRef.current) selectCharacter(id);
    };
    const onStorage = (): void => {
      if (connectedRef.current && selectedIdRef.current) setCoordinatorVersion((value) => value + 1);
    };
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('storage', onStorage);
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
      window.removeEventListener('storage', onStorage);
      menu?.close?.();
    };
  }, [connect, selectCharacter, services]);

  useEffect(() => {
    const titleName = projection?.characterName
      || characters.find((character) => character.id === selectedId)?.name
      || '';
    document.title = titleName ? `${DOCUMENT_TITLE_BASE}: ${titleName}` : DOCUMENT_TITLE_BASE;
  });

  useEffect(() => {
    const compatWindow = window as unknown as { app?: SheetFacade };
    const facade: SheetFacade = {
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
        failedPortraits.current.delete(selected);
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
  const visibleRows: SheetRow[] = (room.entities || [])
    .filter((entity) => entity.isCharacter || entity.kind === 'character')
    .map((entity) => ({
      key: entity.id,
      label: entity.name || entity.id,
      meta: entity.id === selectedId ? 'self' : entity.kind || 'character',
    }));
  const inventoryRows: SheetRow[] = (projection?.inventory || []).map((item) => ({
    key: item.id,
    label: item.label || item.name || item.id,
    meta: item.kind || 'item',
  }));
  const actionNeedle = actionFilter.trim().toLowerCase();
  const actionRows = services.orderActionsByAvailability(projection?.actions || [])
    .filter((action) => {
      if (!actionNeedle) return true;
      const cost = services.actionCost(action);
      return [
        services.actionTitle(action), action.command_type || '', action.tool_name || '',
        services.actionLane(action), action.unavailable_reason || '',
        cost.action ? `${cost.action} AP` : '', cost.focus ? `${cost.focus} FP` : '',
      ].join(' ').toLowerCase().includes(actionNeedle);
    })
    .map((action): SheetRow => {
      const cost = services.actionCost(action);
      const parts = [];
      if (cost.action) parts.push(`${cost.action} AP`);
      if (cost.focus) parts.push(`${cost.focus} FP`);
      return {
        key: `${action.command_type || ''}:${action.tool_name || ''}`,
        label: services.actionTitle(action),
        meta: action.unavailable_reason || `${services.actionLane(action)} · ${parts.join(' + ') || 'free'}`,
        unavailable: !services.actionAvailable(action),
      };
    });
  const uploadDisabled = !connected || !apiBase || !selectedId || Boolean(uploadingPurpose);

  return <>
    <Toolbar id="toolbar">
      <ToolbarRow id="toolbar-row1">
        <ToolbarBrand icon={<img src="favicon.png" alt="" />}>Bunnyland Character Sheet</ToolbarBrand>
        <span class="toolbar-sep">|</span>
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
        <Button id="btn-client-menu" class="client-menu-button">Menu</Button>
      </ToolbarRow>
      <ToolbarRow id="toolbar-row2">
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
      </ToolbarRow>
    </Toolbar>

    <main id="main" class="app-grid">
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

      <section id="details-pane" aria-label="Character details">
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
        <Section id="visible-characters" title="Visible Characters" populated={Boolean(visibleRows.length)}>
          <SheetList emptyMessage="No visible characters." rows={visibleRows} />
        </Section>
        <Section id="inventory" title="Inventory" populated={Boolean(inventoryRows.length)}>
          <SheetList emptyMessage="No inventory items." rows={inventoryRows} />
        </Section>
        <div class="section">
          <div class="section-title">Available Actions</div>
          <div class="action-controls">
            <input
              id="action-filter"
              onInput={(event): void => setActionFilter(event.currentTarget.value)}
              placeholder="Search actions"
              ref={actionFilterRef}
              spellcheck={false}
              type="text"
              value={actionFilter}
            />
            <Button id="action-filter-clear" onClick={(): void => {
              setActionFilter('');
              requestAnimationFrame(() => actionFilterRef.current?.focus());
            }}>Clear</Button>
          </div>
          <div id="actions" class={actionRows.length ? 'sheet-list' : 'sheet-empty'}>
            <SheetList
              emptyMessage={actionNeedle ? 'No matching actions.' : 'No actions available.'}
              rows={actionRows}
            />
          </div>
        </div>
        <div id="status-note">{statusNote}</div>
      </section>
    </main>
  </>;
}

const root = document.getElementById('app');
if (root) render(<CharacterSheetPage />, root);
