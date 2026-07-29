import { normalizeBase, sendJson, serverFromUrl } from '@bunnyland/ui-web/api';
import { AuthProvider, useAuth } from '@bunnyland/ui-web/preact';
import { render } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { confirmDialog } from '../dialogs';
import { findWorldDetails, type WorldDetails } from '../world-details';
import type { SendPatch, Status } from './entity-editor';
import { defaultFor } from './fields';
import { EditorLayout } from './layout';
import {
  applyLocalPatch,
  catalogueNames,
  cloneJson,
  COMMON_COMPONENTS,
  COMMON_EDGES,
  emptyWorld,
  entityDisplayName,
  entityType,
  exportWorld,
  filterEntities,
  isRecord,
  normalizeFragments,
  parseCatalogue,
  parsePatchResult,
  parseRuntimeState,
  parseWorld,
  validateWorld,
  type EditorWorld,
  type JsonObject,
  type PatchOperation,
  type PatchResult,
  type RuntimeState,
  type WorldCatalogue,
  type WorldEdge,
  type WorldEntity,
  type WorldFragment,
} from './models';
import { EditorToolbar } from './toolbar';

export interface LiveAuth { authorized: boolean; request: () => void }
interface ClientConfig { autoConnect: boolean; serverUrl: string }
interface ClientMenu { close?: () => void }

export interface WorldEditorServices {
  confirmDialog: typeof confirmDialog;
  initClientMenu: () => ClientMenu | void;
  loadConfig: () => Promise<unknown>;
  normalizeBase: (value: string) => string;
  sendJson: (base: string, path: string, init?: RequestInit) => Promise<unknown>;
  serverFromUrl: () => string;
}

interface LegacyEditorUi {
  initClientMenu: () => ClientMenu | void;
  loadConfig: () => Promise<unknown>;
}

interface EditorBrowser extends Window { BunnylandUI: LegacyEditorUi }

function legacyUi(): LegacyEditorUi {
  return (window as unknown as EditorBrowser).BunnylandUI;
}

export const browserServices: WorldEditorServices = {
  confirmDialog,
  initClientMenu: () => legacyUi().initClientMenu(),
  loadConfig: () => legacyUi().loadConfig(),
  normalizeBase,
  sendJson,
  serverFromUrl,
};

export interface WorldEditorFacade {
  libraryFragments: WorldFragment[];
  selectedId: string;
  world: EditorWorld;
  worldSchema: WorldCatalogue | null;
  _renderAll(): void;
  _renderEntities(): void;
  _renderJson(): void;
  _renderLibraryControls(): void;
}

interface EditorWindow extends Window { app?: WorldEditorFacade }
const pageWindow = window as EditorWindow;

function parseFocusHash(): string {
  try {
    const parts = (location.hash.replace(/^#/, '').split('?').at(0) || '').split('/').filter(Boolean).map(decodeURIComponent);
    return parts.length > 1 ? parts.slice(1).join('/') : parts[0] || '';
  } catch { return ''; }
}

function parseClientConfig(value: unknown): ClientConfig {
  if (!isRecord(value)) return { autoConnect: false, serverUrl: '' };
  return { autoConnect: Boolean(value.autoConnect), serverUrl: typeof value.serverUrl === 'string' ? value.serverUrl : '' };
}

function contentFragments(value: unknown): { source: string; value: JsonObject } {
  if (!isRecord(value) || !isRecord(value.content)) return { source: 'server', value: {} };
  return { source: typeof value.content.library_id === 'string' ? value.content.library_id : 'server', value: value.content as JsonObject };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function downloadJson(text: string, filename: string, done: () => void): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  URL.revokeObjectURL(url);
  anchor.remove();
  done();
}

export function WorldEditorPage({ liveAuth, services = browserServices }: { liveAuth?: LiveAuth; services?: WorldEditorServices } = {}) {
  const servicesRef = useRef(services);
  servicesRef.current = services;
  const worldRef = useRef<EditorWorld>(emptyWorld());
  const selectedRef = useRef('entity_1');
  const schemaRef = useRef<WorldCatalogue | null>(null);
  const fragmentsRef = useRef<WorldFragment[]>([]);
  const liveBaseRef = useRef('');
  const pendingRef = useRef(parseFocusHash());
  const timersRef = useRef<Record<string, number>>({});
  const mountedRef = useRef(true);
  const liveAuthRef = useRef(liveAuth);
  const queuedLiveRef = useRef('');
  liveAuthRef.current = liveAuth;

  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [fragmentId, setFragmentId] = useState('');
  const [apiUrl, setApiUrl] = useState('/api/v1/');
  const apiUrlRef = useRef(apiUrl);
  apiUrlRef.current = apiUrl;
  const [status, setStatus] = useState<Status>({ kind: '', text: 'Ready' });
  const [runtime, setRuntime] = useState<RuntimeState>({ paused: null, running: false });
  const [snapshotVisible, setSnapshotVisible] = useState(() => localStorage.getItem('bunnyland.editor.snapshotVisible') !== 'false');

  const revise = useCallback((): void => { if (mountedRef.current) setRevision(value => value + 1); }, []);
  const syncUrl = useCallback((push = false): void => {
    const url = new URL(location.href);
    if (liveBaseRef.current) url.searchParams.set('server', liveBaseRef.current); else url.searchParams.delete('server');
    url.hash = selectedRef.current ? encodeURIComponent(selectedRef.current) : '';
    history[push ? 'pushState' : 'replaceState'](null, '', url);
  }, []);
  const selectEntity = useCallback((id: string, sync = true, push = true): void => {
    if (id && worldRef.current.entities[id]) { selectedRef.current = id; pendingRef.current = ''; }
    else if (!id) selectedRef.current = '';
    if (sync) syncUrl(push);
    revise();
  }, [revise, syncUrl]);
  const applyPending = useCallback((): void => {
    const id = pendingRef.current;
    if (id && worldRef.current.entities[id]) selectEntity(id, true, false);
  }, [selectEntity]);

  const requestJson = useCallback(async (path: string, init: RequestInit = {}): Promise<unknown> => {
    if (liveAuthRef.current && !liveAuthRef.current.authorized) {
      liveAuthRef.current.request();
      throw new Error('Sign in with world administration access first');
    }
    if (!liveBaseRef.current) throw new Error('Load a server snapshot first');
    return servicesRef.current.sendJson(liveBaseRef.current, path, init);
  }, []);

  const mergePatch = useCallback((data: PatchResult): void => {
    const world = worldRef.current;
    for (const id of data.deleted_entities) delete world.entities[id];
    for (const entity of data.changed_entities) world.entities[entity.id] = entity;
    if (data.world_epoch != null) {
      world.metadata.epoch = data.world_epoch;
      world.meta.saved_at_epoch = data.world_epoch;
    }
    if (selectedRef.current && !world.entities[selectedRef.current]) selectedRef.current = Object.keys(world.entities)[0] || '';
  }, []);

  const sendPatch = useCallback<SendPatch>(async (operations, merge = false, text = 'Patch applied') => {
    if (!liveBaseRef.current || !operations.length) return null;
    const data = parsePatchResult(await requestJson('/admin/world', { method: 'PATCH', body: JSON.stringify({ operations }) }));
    if (merge) mergePatch(data);
    setStatus({ kind: 'ok', text });
    return data;
  }, [mergePatch, requestJson]);

  const debouncePatch = useCallback((key: string, operations: PatchOperation[]): void => {
    if (!liveBaseRef.current) return;
    window.clearTimeout(timersRef.current[key]);
    timersRef.current[key] = window.setTimeout(() => {
      void sendPatch(operations, false, 'Component patched').catch(error => setStatus({ kind: 'err', text: `Patch error: ${errorMessage(error)}` }));
    }, 350);
  }, [sendPatch]);

  const loadCatalogue = useCallback(async (base: string): Promise<void> => {
    try {
      const response = await servicesRef.current.sendJson(base, '/play/catalog');
      schemaRef.current = parseCatalogue(response);
      const fragments = contentFragments(response);
      fragmentsRef.current = normalizeFragments(fragments.value, fragments.source);
    } catch {
      schemaRef.current = null;
      fragmentsRef.current = [];
    }
    setFragmentId('');
  }, []);

  const loadSnapshot = useCallback(async (base: string): Promise<void> => {
    try {
      liveBaseRef.current = base;
      worldRef.current = parseWorld(await servicesRef.current.sendJson(base, '/admin/world/snapshot', { method: 'GET' }));
      selectedRef.current = pendingRef.current && worldRef.current.entities[pendingRef.current] ? pendingRef.current : Object.keys(worldRef.current.entities)[0] || '';
      try {
        const nextRuntime = parseRuntimeState(await servicesRef.current.sendJson(base, '/admin/world/runtime', { method: 'GET' }));
        setRuntime(nextRuntime);
        if (nextRuntime.world_epoch != null) worldRef.current.metadata.epoch = nextRuntime.world_epoch;
      } catch { setRuntime({ paused: null, running: false }); }
      await loadCatalogue(base);
      applyPending();
      syncUrl();
      revise();
      setStatus({ kind: 'ok', text: 'Server snapshot loaded · live patches enabled' });
    } catch (error) {
      liveBaseRef.current = '';
      setStatus({ kind: 'err', text: `Server error: ${errorMessage(error)}` });
    }
  }, [applyPending, loadCatalogue, revise, syncUrl]);

  const fetchSnapshot = useCallback(async (candidate = apiUrlRef.current): Promise<void> => {
    if (liveAuthRef.current && !liveAuthRef.current.authorized) {
      queuedLiveRef.current = candidate;
      liveAuthRef.current.request();
      setStatus({ kind: '', text: 'Sign in to load a live server snapshot' });
      return;
    }
    queuedLiveRef.current = '';
    const base = servicesRef.current.normalizeBase(candidate);
    if (base) await loadSnapshot(base);
  }, [loadSnapshot]);
  const fetchSnapshotRef = useRef(fetchSnapshot);
  fetchSnapshotRef.current = fetchSnapshot;

  useEffect(() => {
    if (!liveAuth?.authorized || !queuedLiveRef.current) return;
    const server = queuedLiveRef.current;
    queuedLiveRef.current = '';
    void fetchSnapshotRef.current(server);
  }, [liveAuth?.authorized]);

  useEffect(() => {
    mountedRef.current = true;
    const menu = servicesRef.current.initClientMenu();
    const facade: WorldEditorFacade = {
      get libraryFragments() { return fragmentsRef.current; }, set libraryFragments(value) { fragmentsRef.current = value; },
      get selectedId() { return selectedRef.current; }, set selectedId(value) { selectedRef.current = value; },
      get world() { return worldRef.current; }, set world(value) { worldRef.current = isRecord(value.meta) ? value : parseWorld(value); },
      get worldSchema() { return schemaRef.current; }, set worldSchema(value) { schemaRef.current = value; },
      _renderAll: revise, _renderEntities: revise, _renderJson: revise, _renderLibraryControls: revise,
    };
    pageWindow.app = facade;
    const onLocation = (): void => {
      const id = parseFocusHash();
      if (!id) selectEntity('', false);
      else if (worldRef.current.entities[id]) selectEntity(id, false);
      else { pendingRef.current = id; selectedRef.current = ''; revise(); }
    };
    window.addEventListener('hashchange', onLocation);
    window.addEventListener('popstate', onLocation);
    void (async () => {
      const config = parseClientConfig(await servicesRef.current.loadConfig());
      const urlServer = servicesRef.current.serverFromUrl();
      const server = urlServer || config.serverUrl;
      if (server) { setApiUrl(server); apiUrlRef.current = server; }
      if (urlServer || config.autoConnect && server) {
        if (liveAuthRef.current && !liveAuthRef.current.authorized) {
          queuedLiveRef.current = server;
          setStatus({ kind: '', text: 'Sign in to load a live server snapshot' });
          applyPending();
          return;
        }
        const base = servicesRef.current.normalizeBase(server);
        if (base) await loadSnapshot(base);
      } else applyPending();
    })().catch(error => setStatus({ kind: 'err', text: `Load error: ${errorMessage(error)}` }));
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      Object.values(timers).forEach(timer => window.clearTimeout(timer));
      window.removeEventListener('hashchange', onLocation);
      window.removeEventListener('popstate', onLocation);
      menu?.close?.();
      if (pageWindow.app === facade) delete pageWindow.app;
    };
  }, [applyPending, loadSnapshot, revise, selectEntity]);

  const world = worldRef.current;
  const selected = selectedRef.current ? world.entities[selectedRef.current] || null : null;
  void revision;
  const componentNames = [...new Set([...catalogueNames(world, 'components', COMMON_COMPONENTS), ...Object.keys(schemaRef.current?.components || {})])].sort();
  const edgeNames = [...new Set([...catalogueNames(world, 'relationships', COMMON_EDGES), ...Object.keys(schemaRef.current?.edges || {})])].sort();
  const entities = filterEntities(world, search);
  const exported = exportWorld(world);
  const jsonText = JSON.stringify(exported, null, 2);
  const problems = validateWorld(exported);
  const worldDetails = findWorldDetails(world.entities);
  const inspectorHref = selected ? (() => {
    const url = new URL('inspector.html', location.href);
    const base = liveBaseRef.current || servicesRef.current.normalizeBase(apiUrl);
    if (base) url.searchParams.set('server', base); else url.searchParams.delete('server');
    url.hash = `map/${encodeURIComponent(selected.id)}`;
    return url.toString();
  })() : '';

  const updateComponent = (type: string, fields: JsonObject): void => {
    const entity = worldRef.current.entities[selectedRef.current];
    if (!entity) return;
    entity.components[type] = fields;
    revise();
    debouncePatch(`component:${entity.id}:${type}`, [{ op: 'set_component', entity_id: entity.id, component: { type, fields } }]);
  };
  const updateEdge = (type: string, index: number, next: WorldEdge): void => {
    const entity = worldRef.current.entities[selectedRef.current];
    const previous = entity?.relationships[type]?.[index];
    if (!entity || !previous) return;
    entity.relationships[type]![index] = next;
    revise();
    if (next.target) {
      const operations: PatchOperation[] = previous.target && previous.target !== next.target ? [{ op: 'remove_edge', source_id: entity.id, target_id: previous.target, edge_type: type }] : [];
      operations.push({ op: 'set_edge', source_id: entity.id, target_id: next.target, edge: { type, fields: next.edge } });
      debouncePatch(`edge:${entity.id}:${type}:${index}`, operations);
    }
  };
  const defaultComponent = (type: string, entity: WorldEntity): JsonObject => {
    const schema = schemaRef.current?.components[type]?.json_schema;
    if (schema?.properties) return Object.fromEntries(Object.entries(schema.properties).map(([name, raw]) => [name, defaultFor(raw, schema)]));
    if (type === 'IdentityComponent') return { name: entity.id, kind: 'entity', tags: [] };
    if (type === 'RoomComponent') return { title: entity.id, biome: 'unknown', indoor: false, private: false, safe: true };
    if (type === 'CharacterComponent') return { species: 'bunny', biography: '', public: true };
    if (type === 'WorldClockComponent') return { game_time_seconds: 0, tick_index: 0, time_scale: 1 };
    return {};
  };
  const defaultEdge = (type: string): JsonObject => type === 'Contains' ? { mode: 'room_content', visible: true, discovered: true, order: 0 }
    : type === 'ExitTo' ? { direction: '', label: '', locked: false, hidden: false, action_cost: 1 }
    : type === 'ControlledBy' ? { generation: 0, since_epoch: world.metadata.epoch } : {};

  const importFragment = async (): Promise<void> => {
    const fragment = fragmentsRef.current.find(item => item.id === fragmentId);
    if (!fragment) return;
    try {
      const operations = cloneJson(fragment.operations);
      if (fragment.root_client_id && fragment.attach_edge) {
        if (!selected) throw new Error('select a destination entity first');
        const edge = cloneJson(fragment.attach_edge);
        if (edge.type === 'Contains') edge.fields = { ...edge.fields, mode: selected.components.CharacterComponent ? 'inventory' : selected.components.ContainerComponent ? 'container' : 'room_content' };
        operations.push({ op: 'set_edge', source_id: selected.id, target_id: fragment.root_client_id, edge });
      }
      let created: string[];
      if (liveBaseRef.current) {
        const data = await sendPatch(operations, true, `${fragment.title} imported`);
        created = (data?.changed_entities || []).map(entity => entity.id).filter(entityId => entityId !== selectedRef.current);
      } else created = applyLocalPatch(worldRef.current, operations);
      if (created[0]) selectedRef.current = created[0];
      setFragmentId('');
      revise();
      syncUrl();
      setStatus({ kind: 'ok', text: `${fragment.title} imported` });
    } catch (error) { setStatus({ kind: 'err', text: `Import error: ${errorMessage(error)}` }); }
  };

  const addEntity = async (): Promise<void> => {
    let id: string;
    if (liveBaseRef.current) {
      const data = await sendPatch([{ op: 'add_entity', components: [{ type: 'IdentityComponent', fields: { name: 'entity', kind: 'entity', tags: [] } }] }], true, 'Entity added');
      id = data?.changed_entities[0]?.id || Object.keys(worldRef.current.entities)[0] || '';
    } else {
      let index = Object.keys(worldRef.current.entities).length + 1;
      while (worldRef.current.entities[`entity_${index}`]) index += 1;
      id = `entity_${index}`;
      worldRef.current.entities[id] = { id, prefab: 'entity', created_epoch: worldRef.current.metadata.epoch, components: { IdentityComponent: { name: id, kind: 'entity', tags: [] } }, relationships: {} };
    }
    selectedRef.current = id;
    revise();
    syncUrl();
    setStatus({ kind: 'ok', text: 'Entity added' });
  };
  const deleteSelected = async (): Promise<void> => {
    if (!selected) return;
    const confirmed = await servicesRef.current.confirmDialog(`Delete ${selected.id}? Incoming edges will also be removed.`, { confirmLabel: 'Delete', title: 'Delete entity', tone: 'danger' });
    if (!confirmed) return;
    if (liveBaseRef.current) await sendPatch([{ op: 'delete_entity', entity_id: selected.id }], true, 'Entity deleted');
    else delete worldRef.current.entities[selected.id];
    for (const other of Object.values(worldRef.current.entities)) for (const [type, edges] of Object.entries(other.relationships)) {
      other.relationships[type] = edges.filter(edge => edge.target !== selected.id);
      if (!other.relationships[type]?.length) delete other.relationships[type];
    }
    selectedRef.current = Object.keys(worldRef.current.entities)[0] || '';
    revise(); syncUrl(); setStatus({ kind: 'ok', text: 'Entity deleted' });
  };

  return <>
    <EditorToolbar
      apiUrl={apiUrl} fragmentId={fragmentId} fragments={fragmentsRef.current} live={Boolean(liveBaseRef.current)} liveAuthorized={!liveAuth || liveAuth.authorized}
      runtime={runtime} selected={selected} snapshotVisible={snapshotVisible} status={status} world={world}
      onApiUrl={setApiUrl}
      onCopy={() => { void navigator.clipboard.writeText(jsonText).then(() => setStatus({ kind: 'ok', text: 'World JSON copied' })).catch(() => setStatus({ kind: 'err', text: 'Clipboard unavailable' })); }}
      onDownload={() => downloadJson(jsonText, `${String(world.meta.seed || 'world').replace(/[^a-zA-Z0-9_.-]+/g, '_') || 'world'}.json`, () => setStatus({ kind: 'ok', text: 'World JSON downloaded' }))}
      onExportFragment={() => { if (!selected) return; const fragment: JsonObject = { schema_version: 1, id: `export/${selected.id}`, title: entityDisplayName(selected), kind: entityType(selected), root_client_id: '$root', operations: [{ op: 'add_entity', client_id: '$root', prefab: selected.prefab, components: Object.entries(selected.components).map(([type, fields]) => ({ type, fields: cloneJson(fields) })) }] }; downloadJson(JSON.stringify(fragment, null, 2), `${selected.id}.fragment.json`, () => setStatus({ kind: 'ok', text: 'Fragment JSON downloaded' })); }}
      onFetch={() => { void fetchSnapshot(); }}
      onFragmentFile={file => { void file.text().then(text => { fragmentsRef.current.push(...normalizeFragments(JSON.parse(text) as unknown, file.name)); revise(); }).catch(error => setStatus({ kind: 'err', text: `Load error: ${errorMessage(error)}` })); }}
      onFragmentId={setFragmentId}
      onImportFragment={() => { void importFragment(); }}
      onLoadWorld={file => { void file.text().then(text => { worldRef.current = parseWorld(JSON.parse(text) as unknown); liveBaseRef.current = ''; selectedRef.current = pendingRef.current && worldRef.current.entities[pendingRef.current] ? pendingRef.current : Object.keys(worldRef.current.entities)[0] || ''; revise(); syncUrl(); setStatus({ kind: 'ok', text: 'World loaded' }); }).catch(error => setStatus({ kind: 'err', text: `Load error: ${errorMessage(error)}` })); }}
      onMetadata={(key, value) => { if (key === 'epoch') { world.metadata.epoch = Number(value); world.meta.saved_at_epoch = Number(value); } else world.meta[key] = String(value); revise(); }}
      onNew={() => { worldRef.current = emptyWorld(); selectedRef.current = 'entity_1'; liveBaseRef.current = ''; schemaRef.current = null; fragmentsRef.current = []; setFragmentId(''); setRuntime({ paused: null, running: false }); revise(); syncUrl(); setStatus({ kind: 'ok', text: 'New world created' }); }}
      onRefreshLibrary={() => { if (!liveBaseRef.current) { setStatus({ kind: 'err', text: 'Load a server snapshot before refreshing the library' }); return; } void servicesRef.current.sendJson(liveBaseRef.current, '/play/catalog').then(response => { const fragments = contentFragments(response); fragmentsRef.current = normalizeFragments(fragments.value, fragments.source); setFragmentId(''); revise(); setStatus({ kind: 'ok', text: `Loaded ${fragmentsRef.current.length} library fragments` }); }).catch(error => setStatus({ kind: 'err', text: `Library error: ${errorMessage(error)}` })); }}
      onSaveLive={() => { void requestJson('/admin/world/checkpoints', { method: 'POST' }).then(raw => { const data = parsePatchResult(raw); if (data.world_epoch != null) { world.metadata.epoch = data.world_epoch; world.meta.saved_at_epoch = data.saved_at_epoch ?? data.world_epoch; revise(); } setStatus({ kind: 'ok', text: 'World saved' }); }).catch(error => setStatus({ kind: 'err', text: `Save error: ${errorMessage(error)}` })); }}
      onWorldDetails={async (details: WorldDetails) => {
        if (!worldDetails) throw new Error('World clock entity is missing');
        const fields: JsonObject = {
          content_flags: details.contentFlags,
          description: details.description,
          title: details.title,
        };
        world.entities[worldDetails.entityId]!.components.WorldInfoComponent = fields;
        revise();
        if (liveBaseRef.current) {
          await sendPatch([{
            op: 'set_component',
            entity_id: worldDetails.entityId,
            component: { type: 'WorldInfoComponent', fields },
          }], false, 'World details saved');
        } else setStatus({ kind: 'ok', text: 'World details updated' });
      }}
      onToggleLive={() => { void requestJson('/admin/world/runtime', { method: 'PATCH', body: JSON.stringify({ paused: !runtime.paused }) }).then(raw => { const data = parseRuntimeState(raw); setRuntime(data); if (data.world_epoch != null) world.metadata.epoch = data.world_epoch; revise(); setStatus({ kind: 'ok', text: data.paused ? 'World paused' : 'World resumed' }); }).catch(error => setStatus({ kind: 'err', text: `Runtime error: ${errorMessage(error)}` })); }}
      onToggleSnapshot={() => { const next = !snapshotVisible; setSnapshotVisible(next); localStorage.setItem('bunnyland.editor.snapshotVisible', String(next)); }}
      worldDetails={worldDetails}
    />
    <EditorLayout
      componentNames={componentNames} defaultComponent={defaultComponent} defaultEdge={defaultEdge} edgeNames={edgeNames} entities={entities} inspectorHref={inspectorHref} jsonText={jsonText} live={Boolean(liveBaseRef.current)}
      onAddEntity={() => { void addEntity().catch(error => setStatus({ kind: 'err', text: `Patch error: ${errorMessage(error)}` })); }} onComponent={updateComponent} onDeleteEntity={() => { void deleteSelected().catch(error => setStatus({ kind: 'err', text: `Delete error: ${errorMessage(error)}` })); }} onEdge={updateEdge} onRevise={revise} onSearch={setSearch} onSelect={selectEntity} onStatus={setStatus}
      problems={problems} schema={schemaRef.current} search={search} selected={selected} sendPatch={sendPatch} snapshotVisible={snapshotVisible} world={world}
    />
    <datalist id="component-options">{componentNames.map(name => <option value={name} key={name} />)}</datalist>
    <datalist id="edge-options">{edgeNames.map(name => <option value={name} key={name} />)}</datalist>
    <datalist id="entity-options">{Object.values(world.entities).sort((a, b) => a.id.localeCompare(b.id)).map(entity => <option value={entity.id} key={entity.id}>{entityDisplayName(entity)}</option>)}</datalist>
  </>;
}

const root = document.getElementById('app');
if (root) {
  function WorldEditorEntry() {
    const { hasScopes, openLogin, status: authStatus } = useAuth();
    const authorized = authStatus === 'authenticated' && hasScopes(['world:admin']);
    const request = useCallback((): void => openLogin(['world:admin']), [openLogin]);
    const liveAuth = useMemo<LiveAuth>(() => ({ authorized, request }), [authorized, request]);
    return <WorldEditorPage liveAuth={liveAuth} />;
  }
  render(<AuthProvider base={serverFromUrl() || '/api/v1'}><WorldEditorEntry /></AuthProvider>, root);
}
