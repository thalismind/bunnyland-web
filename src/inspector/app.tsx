import { AuthProvider, useAuth } from '@bunnyland/ui-web/preact';
import { LiteGraph as LiteGraphLibrary } from 'litegraph.js/build/litegraph.core.js';
import 'litegraph.js/css/litegraph.css';
import { render } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { EventFeed, type InspectorEventItem } from './event-feed';
import { SearchHits, type InspectorSearchHit } from './search-hits';
import { confirmDialog, promptDialog } from '../dialogs';
import { findWorldDetails, WorldDetailsEditor, type WorldDetails } from '../world-details';
import {
  type GraphNode,
  type LiteGraphCanvas,
  type LiteGraphModel,
  type LiteGraphRuntime,
  WorldGraphController,
} from './world-graph-controller';

type View = 'map' | 'region' | 'social' | 'quest';
type GenerationKind = 'room' | 'character' | 'item';
type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
interface JsonObject { [key: string]: JsonValue | undefined }
interface ComponentFields extends JsonObject {
  biome?: string;
  celsius?: number;
  claimed?: boolean;
  climate?: string;
  color?: string;
  completed?: boolean;
  detail?: string;
  direction?: string;
  emoji?: string;
  generator?: string;
  icon?: string;
  indoor?: boolean;
  kind?: string;
  label?: string;
  mode?: string;
  order?: number;
  population?: number;
  quest_id?: string;
  seed?: string;
  short?: string;
  species?: string;
  status?: string;
  terrain?: string;
}
interface Relationship { edge?: ComponentFields; target: string }
interface Entity {
  components: Record<string, ComponentFields>;
  id: string;
  relationships: Record<string, Relationship[]>;
}
interface World { entities: Record<string, Entity>; epoch: number; meta: ComponentFields }
type Crumb = { entityId: string; label: string };
type Menu = { entityId: string; left: number; top: number } | null;
type Status = { className: string; text: string };

interface AdminRequestOptions {
  body?: string;
  getAuth?: () => string | null;
  method?: string;
  prompt?: boolean;
  setAuth?: (auth: string) => void;
}
interface PatchOptions { selectEntityId?: string; status?: string }
interface PatchResponse {
  changed_entities?: Entity[];
  deleted_entities?: string[];
  world_epoch?: number;
}
interface GenerationResponse {
  result?: { patch?: { operations?: JsonObject[] } };
}
interface AdminResponse extends GenerationResponse, PatchResponse {
  paused?: boolean | null;
  running?: boolean;
}
interface SearchFilter { key: string; value: string }
interface SearchQuery { filters: SearchFilter[]; text: string }
interface ControllerInfo { color: string; detail?: string; icon: string; label: string }
interface ClientMenu { close?: () => void }
interface ClientConfig { autoConnect?: boolean; serverUrl?: string }
interface LiveAuth { authorized: boolean; request: () => void }

type LegacyWindow = {
  BunnylandApi: {
    assertSameOriginBase(value: string): string;
    getClientId(): string;
    normalizeBase(value: unknown): string;
    sendAdmin(base: string, path: string, options?: AdminRequestOptions): Promise<AdminResponse>;
    serverFromUrl(): string;
    socketUrl(base: string, path: string, auth: string | null): string;
  };
  BunnylandEvents: {
    eventSummary(type: string, event: JsonObject, nameFor: (id: string) => string): string;
    icon(type: string): string;
  };
  BunnylandUI: {
    cloneJson<T extends JsonValue>(value: T): T;
    initClientMenu(options?: { showOnFirstLoad?: boolean }): ClientMenu | void;
    loadConfig(): Promise<ClientConfig>;
  };
  BunnylandWorld: {
    controlInfo(entity: Entity, world: World): ControllerInfo | null;
    controllerInfo(entity: Entity): ControllerInfo | null;
    entityDisplayName(entity: Entity, options?: { maxFallback?: number }): string;
    entityType(entity: Entity): string;
    parseApiSnapshot(value: unknown): World;
    parseEntitySearch(value: string): SearchQuery;
    parseSnapshot(value: unknown): World;
  };
  LGraph: LiteGraphRuntime['LGraph'];
  LGraphCanvas: LiteGraphRuntime['LGraphCanvas'];
  LGraphNode: LiteGraphRuntime['LGraphNode'];
  LiteGraph: LiteGraphRuntime['LiteGraph'];
  app?: InspectorFacade;
};

/** Browser-test compatibility seam. The Preact page remains the owner of all state and rendering. */
export interface InspectorFacade {
  _apiBase: string | null;
  readonly _applyWorld: (world: World, options?: { resetView?: boolean }) => void;
  readonly _assignController: (entityId: string, controllerId: string) => Promise<void>;
  readonly _cloneEntityOperations: (entityId: string, clientId?: string) => JsonObject[];
  readonly _deleteEntity: (entityId: string) => Promise<void>;
  readonly _monitorRoom: (entityId: string) => Promise<void>;
  readonly _nodeMap: Record<string, GraphNode>;
  readonly _pushEntity: (entityId: string) => void;
  _sendAdmin: (path: string, options?: AdminRequestOptions) => Promise<AdminResponse>;
  _sendPatch: (operations: JsonObject[], options?: PatchOptions) => Promise<PatchResponse | null>;
  readonly _setApiStatus: (className: string, text: string) => void;
  readonly _showContextMenu: (entityId: string, clientX: number, clientY: number) => void;
  readonly lgcanvas: LiteGraphCanvas | null;
  readonly lgraph: LiteGraphModel | null;
  readonly loadSnapshot: (json: unknown) => void;
  readonly selectEntity: (entityId: string) => void;
  readonly setRootView: (view: View) => void;
  readonly world: World | null;
}

type LiteGraphBundle = LiteGraphRuntime['LiteGraph'] & Pick<LiteGraphRuntime, 'LGraph' | 'LGraphCanvas' | 'LGraphNode'>;

function isLiteGraphBundle(value: unknown): value is LiteGraphBundle {
  return (
    typeof value === 'object' && value !== null
    && 'LGraph' in value && typeof value.LGraph === 'function'
    && 'LGraphCanvas' in value && typeof value.LGraphCanvas === 'function'
    && 'LGraphNode' in value && typeof value.LGraphNode === 'function'
    && 'NODE_WIDGET_HEIGHT' in value && typeof value.NODE_WIDGET_HEIGHT === 'number'
    && 'createNode' in value && typeof value.createNode === 'function'
    && 'registerNodeType' in value && typeof value.registerNodeType === 'function'
  );
}

const liteGraphBundle: unknown = LiteGraphLibrary;
if (!isLiteGraphBundle(liteGraphBundle)) {
  throw new Error('Bundled LiteGraph runtime is incomplete');
}
const legacyWindow = window as unknown as LegacyWindow;
legacyWindow.LGraph = liteGraphBundle.LGraph;
legacyWindow.LGraphCanvas = liteGraphBundle.LGraphCanvas;
legacyWindow.LGraphNode = liteGraphBundle.LGraphNode;
legacyWindow.LiteGraph = liteGraphBundle;

const legacy = (): LegacyWindow => legacyWindow;
const CONTAINMENT_EDGES = ['Contains', 'Holding', 'Wearing'];
const SOCIAL_EDGES: Record<string, { color: string; label: string }> = {
  PartnerOf: { color: '#f38ba8', label: 'partner' },
  RelationshipStatus: { color: '#cba6f7', label: 'relationship' },
  ParentOf: { color: '#a6e3a1', label: 'parent of' },
  JealousOf: { color: '#fab387', label: 'jealous of' },
  MemberOf: { color: '#89b4fa', label: 'member of' },
  SocialBond: { color: '#585b70', label: 'social bond' },
};
const ENTITY_STYLE: Record<string, { color: string; bgcolor: string; titleColor: string; icon: string }> = {
  region: { color: '#4d5f1a', bgcolor: '#2d3910', titleColor: '#a6e3a1', icon: '🌐' },
  room: { color: '#1a5f7a', bgcolor: '#0e3f52', titleColor: '#74c7ec', icon: '🏠' },
  character: { color: '#2a6a3a', bgcolor: '#1a4228', titleColor: '#a6e3a1', icon: '🐰' },
  container: { color: '#6a4a1a', bgcolor: '#402e0a', titleColor: '#fab387', icon: '📦' },
  item: { color: '#4a3a6a', bgcolor: '#2a2048', titleColor: '#cba6f7', icon: '✦' },
  other: { color: '#383848', bgcolor: '#222232', titleColor: '#a6adc8', icon: '⬡' },
  door: { color: '#5a5030', bgcolor: '#332d18', titleColor: '#f9e2af', icon: '🚪' },
  quest: { color: '#6a5a1a', bgcolor: '#3f350a', titleColor: '#f9e2af', icon: '📜' },
  objective: { color: '#1a5a6a', bgcolor: '#0e3a45', titleColor: '#89dceb', icon: '◻' },
  reward: { color: '#5a3a6a', bgcolor: '#341f40', titleColor: '#cba6f7', icon: '🎁' },
};
const REGION_KIND_STYLE: Record<string, typeof ENTITY_STYLE[string]> = {
  planet: { color: '#3456a4', bgcolor: '#17213d', titleColor: '#9cc7ff', icon: '🪐' },
  continent: { color: '#2f7d46', bgcolor: '#143320', titleColor: '#9ee6a8', icon: '🗺️' },
  country: { color: '#8b6a1f', bgcolor: '#38290d', titleColor: '#f5d77a', icon: '⚑' },
  region: { color: '#2f7f78', bgcolor: '#123533', titleColor: '#94e2d5', icon: '🌐' },
  province: { color: '#4d7a35', bgcolor: '#203516', titleColor: '#b7e87a', icon: '◇' },
  state: { color: '#4d7a35', bgcolor: '#203516', titleColor: '#b7e87a', icon: '◇' },
  city: { color: '#9a5332', bgcolor: '#3d2115', titleColor: '#fab387', icon: '🏙️' },
  area: { color: '#7d6a2f', bgcolor: '#322912', titleColor: '#f9e2af', icon: '▣' },
  zone: { color: '#7d6a2f', bgcolor: '#322912', titleColor: '#f9e2af', icon: '▣' },
  neighborhood: { color: '#7d6a2f', bgcolor: '#322912', titleColor: '#f9e2af', icon: '▣' },
  neighbourhood: { color: '#7d6a2f', bgcolor: '#322912', titleColor: '#f9e2af', icon: '▣' },
  district: { color: '#7d6a2f', bgcolor: '#322912', titleColor: '#f9e2af', icon: '▣' },
  street: { color: '#59616d', bgcolor: '#242932', titleColor: '#bac2de', icon: '↔' },
  building: { color: '#536879', bgcolor: '#1f2b34', titleColor: '#89dceb', icon: '🏢' },
  level: { color: '#6d5a96', bgcolor: '#2b233e', titleColor: '#cba6f7', icon: '▤' },
  story: { color: '#6d5a96', bgcolor: '#2b233e', titleColor: '#cba6f7', icon: '▤' },
  storey: { color: '#6d5a96', bgcolor: '#2b233e', titleColor: '#cba6f7', icon: '▤' },
  floor: { color: '#6d5a96', bgcolor: '#2b233e', titleColor: '#cba6f7', icon: '▤' },
};
const REGION_LEVELS: Record<string, number> = { planet: 0, continent: 1, country: 2, region: 3, province: 3, state: 3, city: 4, area: 5, zone: 5, neighborhood: 5, neighbourhood: 5, district: 5, street: 6, building: 7, level: 8, story: 8, storey: 8, floor: 8 };
const DIR_OFFSET: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], northeast: [1, -1], northwest: [-1, -1], southeast: [1, 1], southwest: [-1, 1], up: [0, -1], down: [0, 1], fore: [0, -1], aft: [0, 1], port: [-1, 0], starboard: [1, 0] };

function entityType(entity: Entity): string { return legacy().BunnylandWorld.entityType(entity); }
function entityName(entity: Entity): string { return legacy().BunnylandWorld.entityDisplayName(entity, { maxFallback: 24 }); }
function entityStyle(entity: Entity) {
  const type = entityType(entity);
  if (type === 'region') return REGION_KIND_STYLE[String(entity.components.RegionComponent?.kind || '').toLowerCase()] || ENTITY_STYLE.region!;
  return ENTITY_STYLE[type] || ENTITY_STYLE.other!;
}
function entityIcon(entity: Entity): string { return entity.components.EditorDisplayComponent?.emoji || entityStyle(entity).icon; }
function compact(value: unknown, max = 28): string {
  if (value == null || value === '') return '';
  const text = Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value);
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
function population(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return compact(value, 16);
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(value)}`;
}
function regionRows(entity: Entity): string[] {
  const region = entity.components.RegionComponent;
  if (!region) return [];
  const temp = entity.components.TemperatureComponent?.celsius;
  const terrain = compact(region.terrain, 16);
  const climate = compact(region.climate, 14);
  const terrainIcon = /mountain|hill|cliff|ridge/i.test(terrain) ? '⛰️' : /river|lake|sea|coast|water/i.test(terrain) ? '🌊' : /forest|garden|wood/i.test(terrain) ? '🌳' : /city|urban|street|road/i.test(terrain) ? '🏙️' : '🌐';
  return [[region.population != null && `👥 ${population(region.population)}`, typeof temp === 'number' && Number.isFinite(temp) && `🌡️ ${Math.round(temp)} C`].filter(Boolean).join(' · '), compact([climate && `🌦️ ${climate}`, terrain && `${terrainIcon} ${terrain}`].filter(Boolean).join(' · '), 28)].filter(Boolean);
}
function subtitle(entity: Entity): string {
  const c = entity.components;
  if (c.RegionComponent) return c.RegionComponent.kind || 'region';
  if (c.RoomComponent) return [c.RoomComponent.biome, c.RoomComponent.indoor ? 'indoor' : 'outdoor'].filter(Boolean).join(' · ');
  if (c.CharacterComponent) return c.CharacterComponent.species || '';
  if (c.QuestComponent) return c.QuestComponent.status || 'quest';
  if (c.QuestObjectiveComponent) return c.QuestObjectiveComponent.completed ? '✅ done' : '⬜ to do';
  if (c.QuestRewardComponent) return c.QuestRewardComponent.claimed ? 'claimed' : 'unclaimed';
  return c.DescriptionComponent?.short || c.IdentityComponent?.kind || '';
}
function children(entity: Entity, world: World) {
  return CONTAINMENT_EDGES.flatMap((type) => (entity.relationships[type] || []).map((rel) => ({ ...rel, type }))).filter((rel) => world.entities[rel.target] && entityType(world.entities[rel.target]!) !== 'room');
}
function regionalEdges(world: World) {
  return Object.values(world.entities).flatMap((source) => (source.relationships.Contains || []).filter((rel) => rel.edge?.mode === 'region' && world.entities[rel.target]).map((rel) => ({ source: source.id, target: rel.target, edge: rel.edge || {} })));
}
function regionalLevel(entity: Entity, fallback: number): number { return entity.components.RoomComponent ? 9 : REGION_LEVELS[String(entity.components.RegionComponent?.kind || '').toLowerCase()] ?? fallback; }
function compareRegions(
  world: World,
  a: string,
  b: string,
  edgeA: ComponentFields = {},
  edgeB: ComponentFields = {},
): number {
  return (edgeA.order ?? 0) - (edgeB.order ?? 0) || regionalLevel(world.entities[a]!, 0) - regionalLevel(world.entities[b]!, 0) || entityName(world.entities[a]!).localeCompare(entityName(world.entities[b]!)) || a.localeCompare(b);
}
export function layoutRegions(world: World, ids: string[]): Record<string, [number, number]> {
  const incoming: Record<string, number> = {};
  const kids: Record<string, Array<{ edge: ComponentFields; id: string }>> = {};
  ids.forEach((id) => { incoming[id] = 0; kids[id] = []; });
  for (const rel of regionalEdges(world)) if (rel.source in incoming && rel.target in incoming) { incoming[rel.target]!++; kids[rel.source]!.push({ id: rel.target, edge: rel.edge }); }
  Object.keys(kids).forEach((id) => kids[id]!.sort((a, b) => compareRegions(world, a.id, b.id, a.edge, b.edge)));
  const positions: Record<string, [number, number]> = {}, visited = new Set<string>(); let leaf = 0;
  const place = (id: string, depth: number, stack = new Set<string>()): number => {
    if (stack.has(id)) { const x = leaf++ * 286; positions[id] = [x, depth * 145]; return x; }
    if (visited.has(id)) return positions[id]![0];
    stack.add(id); const xs = kids[id]!.map((kid) => place(kid.id, depth + 1, stack)); const x = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : leaf++ * 286;
    stack.delete(id); visited.add(id); positions[id] = [x, depth * 145]; return x;
  };
  ids.filter((id) => incoming[id] === 0).sort((a, b) => compareRegions(world, a, b)).forEach((id) => place(id, 0));
  [...ids].sort((a, b) => compareRegions(world, a, b)).forEach((id) => { if (!visited.has(id)) place(id, Math.max(0, regionalLevel(world.entities[id]!, 0))); });
  const minX = Math.min(0, ...Object.values(positions).map(([x]) => x)); Object.values(positions).forEach((pos) => { pos[0] += 80 - minX; pos[1] += 60; }); return positions;
}
export function layoutRooms(world: World, ids: string[]): Record<string, [number, number]> {
  const positions: Record<string, [number, number]> = {}, occupied = new Set<string>(), seen = new Set<string>();
  const free = (x: number, y: number): [number, number] => { for (let ring = 0; ring <= ids.length + 4; ring++) for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) { if (ring && Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue; const p: [number, number] = [x + dx * 280, y + dy * 280]; if (!occupied.has(`${p[0]},${p[1]}`)) return p; } return [x, y]; };
  const reserve = (id: string, x: number, y: number) => { const pos = free(x, y); positions[id] = pos; occupied.add(`${pos[0]},${pos[1]}`); seen.add(id); };
  if (!ids.length) return positions; reserve(ids[0]!, 0, 0); const queue = [ids[0]!];
  while (queue.length) { const id = queue.shift()!; for (const rel of world.entities[id]?.relationships.ExitTo || []) { if (!ids.includes(rel.target) || seen.has(rel.target)) continue; const [dx, dy] = DIR_OFFSET[String(rel.edge?.direction || '').toLowerCase()] || [1, 0]; reserve(rel.target, positions[id]![0] + dx * 280, positions[id]![1] + dy * 280); queue.push(rel.target); } }
  let col = 0; ids.forEach((id) => { if (!positions[id]) reserve(id, col++ * 280, 560); });
  const minX = Math.min(...Object.values(positions).map(([x]) => x)), minY = Math.min(...Object.values(positions).map(([, y]) => y)); Object.values(positions).forEach((pos) => { pos[0] += 80 - minX; pos[1] += 60 - minY; }); return positions;
}

function Value({ value }: { value: JsonValue | undefined }) {
  if (value == null) return <span class="val-null">null</span>;
  if (typeof value === 'boolean') return <span class={value ? 'val-bool-t' : 'val-bool-f'}>{String(value)}</span>;
  if (typeof value === 'number') return <span class="val-num">{value}</span>;
  if (typeof value === 'string') return <span class="val-str">"{value}"</span>;
  if (Array.isArray(value)) return value.length ? <span>[{value.map((item, i) => <Value key={i} value={item} />)}]</span> : <span class="val-null">[]</span>;
  return <table class="comp-table sub-table"><tbody>{Object.entries(value).map(([key, item]) => <tr key={key}><td class="key">{key}</td><td class="val"><Value value={item} /></td></tr>)}</tbody></table>;
}

function EntityInspector({ apiBase, entity, moved, onSelect, world }: { apiBase: string | null; entity: Entity | null; moved: boolean; onSelect: (id: string) => void; world: World | null }) {
  if (!entity || !world) return <><div id="inspector-header"><div id="inspector-name">No entity selected</div><div id="inspector-id"/><div id="inspector-links"/><div id="inspector-kind"/></div><div id="inspector-body"><div id="inspector-empty">Load a snapshot and click any node<br/>to inspect its ECS components.</div></div></>;
  const type = entityType(entity), style = entityStyle(entity), sub = subtitle(entity), control = legacy().BunnylandWorld.controlInfo(entity, world);
  const editor = new URL('world-editor.html', location.href); if (apiBase) editor.searchParams.set('server', apiBase); editor.hash = encodeURIComponent(entity.id);
  return <><div id="inspector-header"><div id="inspector-name">{entityIcon(entity)} {entityName(entity)}</div><div id="inspector-id">{entity.id}</div><div id="inspector-links"><a class="nav-link" href={editor.toString()}>Open in World Editor</a></div><div id="inspector-kind"><span style={{ color: style.titleColor }}>{type}</span>{sub && <> · {sub}</>}{control && <span class="control-badge" style={{ color: control.color }}> {control.icon} {control.label}{control.detail && ` · ${control.detail}`}</span>}{moved && <span class="control-badge" style={{ color: 'var(--bl-warn)' }}> 🏃 moved recently</span>}</div></div><div id="inspector-body">
    {Object.entries(entity.components).map(([name, fields]) => <details class="comp-section" key={name} open><summary>{name}</summary><table class="comp-table"><tbody>{Object.entries(fields || {}).map(([key, value]) => <tr key={key}><td class="key">{key}</td><td class="val"><Value value={value}/></td></tr>)}</tbody></table></details>)}
    {Object.keys(entity.relationships).length > 0 && <div class="rel-section"><div class="rel-title">🔗 Relationships</div>{Object.entries(entity.relationships).flatMap(([typeName, rels]) => rels.map((rel, i) => <div class="rel-row" key={`${typeName}:${rel.target}:${i}`}><span class="rel-edge-type">{typeName}</span> → <button class="rel-target" data-select-entity={rel.target} onClick={() => onSelect(rel.target)}>{world.entities[rel.target] ? entityName(world.entities[rel.target]!) : rel.target}</button>{rel.edge && Object.keys(rel.edge).length > 0 && <span class="rel-edge-data"> ({Object.entries(rel.edge).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')})</span>}</div>))}</div>}
  </div></>;
}

function parseDeepLink(): { entity: string | null; server: string; view: View | null } {
  const api = legacy().BunnylandApi; let server = api.serverFromUrl(); let hash = location.hash.replace(/^#/, ''); const qi = hash.indexOf('?');
  if (qi >= 0) { if (!server) { const value = new URLSearchParams(hash.slice(qi + 1)).get('server'); server = value ? api.assertSameOriginBase(value) : ''; } hash = hash.slice(0, qi); }
  const parts = hash.split('/').filter(Boolean).map(decodeURIComponent); const view = ['map', 'region', 'social', 'quest'].includes(parts[0] || '') ? parts[0] as View : null;
  return { server, view, entity: parts.slice(1).join('/') || null };
}

export function InspectorApp({ liveAuth }: { liveAuth?: LiveAuth } = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null), wrapperRef = useRef<HTMLDivElement>(null);
  const graphControllerRef = useRef<WorldGraphController | null>(null);
  const worldRef = useRef<World | null>(null), viewRef = useRef<View>('map'), stackRef = useRef<Crumb[]>([]), selectedRef = useRef<string | null>(null), apiBaseRef = useRef<string | null>(null);
  const movedRef = useRef<Record<string, number>>({}), wsRef = useRef<WebSocket | null>(null), refreshRef = useRef<number | null>(null), authRef = useRef<string | null>(null), pendingRef = useRef<ReturnType<typeof parseDeepLink> | null>(null), autoConnectRef = useRef(false), liveAuthRef = useRef(liveAuth);
  liveAuthRef.current = liveAuth;
  const sendAdminOverride = useRef<InspectorFacade['_sendAdmin'] | null>(null), sendPatchOverride = useRef<InspectorFacade['_sendPatch'] | null>(null);
  const pushRef = useRef<(entityId: string) => void>(() => undefined);
  const disconnectRef = useRef<() => void>(() => undefined);
  const [world, setWorld] = useState<World | null>(null), [view, setView] = useState<View>('map'), [stack, setStack] = useState<Crumb[]>([]), [selectedId, setSelectedId] = useState<string | null>(null), [apiBase, setApiBase] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ className: '', text: '○ Offline' }), [runtime, setRuntime] = useState({ paused: null as boolean | null, running: false }), [events, setEvents] = useState<InspectorEventItem[]>([]), [showEvents, setShowEvents] = useState(false), [showParents, setShowParents] = useState(true);
  const [search, setSearch] = useState(''), [searchIndex, setSearchIndex] = useState(0), [searchOpen, setSearchOpen] = useState(false), [menu, setMenu] = useState<Menu>(null), [socialTypes, setSocialTypes] = useState<string[]>([]);
  const eventSequence = useRef(0), showParentsRef = useRef(true), applyingHash = useRef(false);

  const syncUrl = useCallback(() => { if (applyingHash.current) return; const url = new URL(location.href); if (wsRef.current && apiBaseRef.current) url.searchParams.set('server', apiBaseRef.current); const focus = `${viewRef.current}${selectedRef.current ? `/${encodeURIComponent(selectedRef.current)}` : ''}`; url.hash = focus; history.replaceState(null, '', url); }, []);
  const setApiStatus = useCallback((className: string, text: string) => setStatus({ className, text }), []);
  const rootLabel = () => viewRef.current === 'region' ? 'Regions' : viewRef.current === 'social' ? 'Social' : viewRef.current === 'quest' ? 'Quests' : 'Room Map';
  const noteSelection = useCallback((id: string) => { if (!worldRef.current?.entities[id]) return; selectedRef.current = id; setSelectedId(id); syncUrl(); }, [syncUrl]);
  const selectEntity = useCallback((id: string) => { if (!worldRef.current?.entities[id]) return; noteSelection(id); graphControllerRef.current?.selectEntity(id); }, [noteSelection]);

  const renderGraph = useCallback((reset = true) => {
    const current = worldRef.current;
    if (!current) return;
    const specs: Array<{
      entity: Entity;
      enter?: () => void;
      extra?: string[] | string;
      pos: [number, number];
    }> = [];
    const edges: Array<[string, string]> = [];
    setSocialTypes([]);
    if (stackRef.current.length) {
      const id = stackRef.current.at(-1)!.entityId, entity = current.entities[id]; if (!entity) return; specs.push({ entity, pos: [300, 40] });
      for (const rel of children(entity, current)) { const child = current.entities[rel.target]!; const canEnter = children(child, current).length > 0; specs.push({ entity: child, pos: [80 + specs.length * 256, entityType(child) === 'character' ? 220 : 360], ...(canEnter ? { enter: () => pushRef.current(rel.target) } : {}) }); edges.push([id, rel.target]); }
    } else if (viewRef.current === 'region') {
      const ids = [...new Set([...Object.values(current.entities).filter((e) => e.components.RegionComponent).map((e) => e.id), ...regionalEdges(current).flatMap((edge) => [edge.source, edge.target])])]; const pos = layoutRegions(current, ids); ids.forEach((id) => { const entity = current.entities[id]!; specs.push({ entity, pos: pos[id]!, extra: regionRows(entity), ...(entityType(entity) === 'room' ? { enter: () => pushRef.current(id) } : {}) }); }); regionalEdges(current).forEach((edge) => edges.push([edge.source, edge.target]));
    } else if (viewRef.current === 'social') {
      const chars = Object.values(current.entities).filter((e) => e.components.CharacterComponent), present = new Set<string>(), radius = Math.max(200, chars.length * 70); chars.forEach((entity, index) => specs.push({ entity, pos: [520 + radius * Math.cos(index / Math.max(1, chars.length) * Math.PI * 2 - Math.PI / 2) - 120, 360 + radius * Math.sin(index / Math.max(1, chars.length) * Math.PI * 2 - Math.PI / 2)] })); chars.forEach((e) => Object.keys(SOCIAL_EDGES).forEach((type) => (e.relationships[type] || []).forEach((rel) => { if (current.entities[rel.target]?.components.CharacterComponent) { edges.push([e.id, rel.target]); present.add(type); } }))); setSocialTypes([...present]);
    } else if (viewRef.current === 'quest') {
      const all = Object.values(current.entities), quests = all.filter((e) => e.components.QuestComponent); quests.forEach((quest, col) => { specs.push({ entity: quest, pos: [40 + col * 250, 40] }); const qid = quest.components.QuestComponent?.quest_id; all.filter((e) => e.components.QuestObjectiveComponent?.quest_id === qid || e.components.QuestRewardComponent?.quest_id === qid).forEach((child, row) => { specs.push({ entity: child, pos: [40 + col * 250, 200 + row * 110] }); edges.push([quest.id, child.id]); }); });
    } else {
      const rooms = Object.values(current.entities).filter((e) => e.components.RoomComponent), pos = layoutRooms(current, rooms.map((e) => e.id)); rooms.forEach((entity) => specs.push({ entity, pos: pos[entity.id]!, extra: `🐰 ${(entity.relationships.Contains || []).filter((rel) => current.entities[rel.target]?.components.CharacterComponent).length}`, enter: () => pushRef.current(entity.id) })); const linked = new Set<string>(); rooms.forEach((room) => (room.relationships.ExitTo || []).forEach((rel) => { const key = [room.id, rel.target].sort().join('|'); if (!linked.has(key)) { linked.add(key); edges.push([room.id, rel.target]); } }));
    }
    graphControllerRef.current?.reconcile(specs.map(({ entity, enter, extra, pos }) => {
      const style = entityStyle(entity);
      return {
        backgroundColor: style.bgcolor,
        color: style.color,
        id: entity.id,
        ...(enter ? { onEnter: enter } : {}),
        position: pos,
        rows: [subtitle(entity), ...(Array.isArray(extra) ? extra : extra ? [extra] : [])].filter(Boolean),
        title: `${entityIcon(entity)} ${entityName(entity)}`,
        type: entityType(entity),
      };
    }), edges, reset);
  }, []);

  const applyWorld = useCallback((next: World, options: { resetView?: boolean } = {}) => { const reset = options.resetView ?? true; worldRef.current = next; setWorld(next); if (pendingRef.current) { const nav = pendingRef.current; pendingRef.current = null; if (nav.view) { viewRef.current = nav.view; setView(nav.view); } stackRef.current = []; setStack([]); renderGraph(true); if (nav.entity) selectEntity(nav.entity); return; } if (reset) { stackRef.current = []; setStack([]); renderGraph(true); } else renderGraph(false); }, [renderGraph, selectEntity]);
  const loadSnapshot = useCallback((json: unknown) => { disconnectRef.current(); movedRef.current = {}; setEvents([]); applyWorld(legacy().BunnylandWorld.parseSnapshot(json), { resetView: true }); }, [applyWorld]);
  const setRootView = useCallback((next: View) => { viewRef.current = next; setView(next); for (const item of ['map', 'region', 'social', 'quest']) document.getElementById(`btn-view-${item}`)?.classList.toggle('active', item === next); selectedRef.current = null; setSelectedId(null); stackRef.current = []; setStack([]); renderGraph(true); syncUrl(); }, [renderGraph, syncUrl]);
  const push = useCallback((id: string) => { const entity = worldRef.current?.entities[id]; if (!entity) return; stackRef.current = [...stackRef.current, { entityId: id, label: entityName(entity) }]; setStack(stackRef.current); renderGraph(true); }, [renderGraph]);

  const defaultSendAdmin = useCallback(async (path: string, options: AdminRequestOptions = {}) => { if (!apiBaseRef.current) throw new Error('Connect to a live server first'); return legacy().BunnylandApi.sendAdmin(apiBaseRef.current, path, { ...options, getAuth: () => authRef.current, setAuth: (auth: string) => { authRef.current = auth; } }); }, []);
  const sendAdmin = useCallback((path: string, options?: AdminRequestOptions) => (sendAdminOverride.current || defaultSendAdmin)(path, options), [defaultSendAdmin]);
  const mergePatch = useCallback((data: PatchResponse) => {
    const current = worldRef.current;
    if (!current) return;
    const entities = { ...current.entities };
    for (const id of data.deleted_entities || []) delete entities[id];
    for (const item of data.changed_entities || []) {
      const parsed = legacy().BunnylandWorld.parseApiSnapshot({ entities: [item] });
      const entity = parsed.entities[item.id];
      if (entity) entities[item.id] = entity;
    }
    applyWorld({
      ...current,
      entities,
      epoch: data.world_epoch ?? current.epoch,
    }, { resetView: false });
  }, [applyWorld]);
  const defaultSendPatch = useCallback(async (operations: JsonObject[], options: PatchOptions = {}) => { if (!operations.length) return null; const data = await sendAdmin('/admin/world', { method: 'PATCH', body: JSON.stringify({ operations }), prompt: true }); mergePatch(data); setApiStatus('live', options.status || 'Patch applied'); if (options.selectEntityId) selectEntity(options.selectEntityId); return data; }, [mergePatch, selectEntity, sendAdmin, setApiStatus]);
  const sendPatch = useCallback((operations: JsonObject[], options?: PatchOptions) => (sendPatchOverride.current || defaultSendPatch)(operations, options), [defaultSendPatch]);
  const generateEntity = useCallback(async (kind: GenerationKind, targetId: string, direction = '') => {
    const theme = await promptDialog(`Describe the new ${kind}.`, { label: 'Prompt / theme', title: `Generate ${kind}` }); if (theme == null) return;
    const targetKey = kind === 'room' ? 'door_entity_id' : kind === 'character' ? 'room_entity_id' : 'container_entity_id';
    const body: Record<string, string> = { kind, prompt: theme.trim(), [targetKey]: targetId }; if (kind === 'room' && direction) body.direction = direction;
    setMenu(null); setApiStatus('live', `◌ Generating ${kind}…`);
    try {
      const job = await sendAdmin('/admin/world/generation-jobs', { method: 'POST', body: JSON.stringify(body), prompt: true });
      const operations = job?.result?.patch?.operations;
      if (!Array.isArray(operations) || !operations.length) throw new Error(`generation returned no ${kind} patch`);
      const before = new Set(Object.keys(worldRef.current?.entities || {}));
      const result = await sendPatch(operations, { status: `● ${kind[0]!.toUpperCase()}${kind.slice(1)} generated` });
      const created = result?.changed_entities?.find((item) => item.id && !before.has(item.id)); if (created?.id) selectEntity(created.id);
    } catch (error) { setApiStatus('error', `⚠ ${error instanceof Error ? error.message : String(error)}`); }
  }, [selectEntity, sendAdmin, sendPatch, setApiStatus]);
  const generateRoom = useCallback(async () => {
    const doors = Object.values(worldRef.current?.entities || {}).filter((entity) => entity.components.DoorComponent);
    if (!doors.length) { setApiStatus('error', '⚠ Add a door before generating a room'); return; }
    const choices = doors.map((entity) => `${entity.id} · ${entityName(entity)}`).join('\n');
    const doorId = await promptDialog(`Choose a door for the new room:\n${choices}`, { label: 'Door entity ID', title: 'Generate room', value: doors[0]!.id }); if (doorId == null) return;
    const door = doors.find((entity) => entity.id === doorId.trim()); if (!door) { setApiStatus('error', `⚠ ${doorId.trim() || 'That entity'} is not a door`); return; }
    const direction = await promptDialog('Enter a direction such as north, east, or up.', { label: 'Direction', title: 'Generate room' }); if (direction == null) return;
    await generateEntity('room', door.id, direction.trim());
  }, [generateEntity, setApiStatus]);
  const assign = useCallback(async (entityId: string, controllerId: string) => { try { const data = await sendAdmin(`/admin/characters/${encodeURIComponent(entityId)}/controller`, { method: 'PUT', body: JSON.stringify({ controller_id: controllerId }), prompt: true }); mergePatch(data); setApiStatus('live', '● Controller assigned'); } catch (error) { setApiStatus('error', `⚠ ${error instanceof Error ? error.message : String(error)}`); } }, [mergePatch, sendAdmin, setApiStatus]);
  const monitor = useCallback(async (entityId: string) => { const entity = worldRef.current?.entities[entityId]; if (!entity?.components.RoomComponent || entity.components.DiscordRoomFeedComponent) return; const raw = await promptDialog('Enter the Discord channel that should receive room activity.', { label: 'Channel ID', title: 'Monitor room' }); if (raw == null) return; if (!/^\d+$/.test(raw.trim())) { setApiStatus('error', '⚠ Discord channel ID must be a number'); return; } await sendPatch([{ op: 'add_component', entity_id: entityId, component: { type: 'DiscordRoomFeedComponent', fields: { channel_id: Number(raw.trim()) } } }], { status: '● Room monitoring enabled', selectEntityId: entityId }); }, [sendPatch, setApiStatus]);
  const cloneOps = useCallback((entityId: string, clientId = `clone:${entityId}:${Date.now()}`) => { const current = worldRef.current, entity = current?.entities[entityId]; if (!entity || !current) throw new Error('Entity no longer exists'); const operations: JsonObject[] = [{ op: 'add_entity', client_id: clientId, components: Object.entries(entity.components).map(([type, fields]) => ({ type, fields: legacy().BunnylandUI.cloneJson(fields || {}) })) }]; Object.values(current.entities).forEach((source) => Object.entries(source.relationships).forEach(([type, rels]) => { if (CONTAINMENT_EDGES.includes(type)) rels.forEach((rel) => { if (rel.target === entityId) operations.push({ op: 'set_edge', source_id: source.id, target_id: clientId, edge: { type, fields: legacy().BunnylandUI.cloneJson(rel.edge || {}) } }); }); })); return operations; }, []);
  const remove = useCallback(async (id: string) => { if (worldRef.current?.entities[id] && await confirmDialog(`Delete ${id}? Incoming edges will also be removed.`, { confirmLabel: 'Delete', title: 'Delete entity', tone: 'danger' })) await sendPatch([{ op: 'delete_entity', entity_id: id }], { status: '● Entity removed' }); }, [sendPatch]);
  const showMenu = useCallback((entityId: string, x: number, y: number) => { if (!worldRef.current?.entities[entityId]) return; const rect = wrapperRef.current?.getBoundingClientRect(); setMenu({ entityId, left: Math.max(8, x - (rect?.left || 0)), top: Math.max(8, y - (rect?.top || 0)) }); }, []);
  const disconnect = useCallback(() => { if (refreshRef.current != null) clearTimeout(refreshRef.current); const ws = wsRef.current; wsRef.current = null; ws?.close(); setStatus({ className: '', text: '○ Offline' }); setRuntime({ paused: null, running: false }); syncUrl(); }, [syncUrl]);

  const connect = useCallback(async (url: string) => { disconnect(); apiBaseRef.current = legacy().BunnylandApi.normalizeBase(url); setApiBase(apiBaseRef.current); try { await sendAdmin('/admin/world', { method: 'GET', prompt: true }); } catch (error) { setApiStatus('error', `⚠ ${error instanceof Error ? error.message : String(error)}`); return; } const ws = new WebSocket(legacy().BunnylandApi.socketUrl(apiBaseRef.current, '/admin/world/stream', authRef.current)); wsRef.current = ws; ws.onopen = () => { ws.send(JSON.stringify({ type: 'authenticate', data: { client_id: legacy().BunnylandApi.getClientId() } })); setApiStatus('live', '● Connected'); syncUrl(); }; ws.onmessage = (event) => { const msg = JSON.parse(event.data); if (msg.type === 'snapshot') applyWorld(legacy().BunnylandWorld.parseApiSnapshot(msg.data), { resetView: !worldRef.current }); else if (msg.type === 'event') { const data = msg.data, ev = data.event || {}, type = data.event_type || 'Event'; if (type === 'ActorMovedEvent' && ev.actor_id != null) movedRef.current[String(ev.actor_id)] = ev.world_epoch ?? worldRef.current?.epoch ?? 0; const actor = ev.actor_id == null ? null : String(ev.actor_id); const item: InspectorEventItem = { key: `event:${++eventSequence.current}`, type, epoch: ev.world_epoch != null ? `${ev.world_epoch}s` : '', icon: legacy().BunnylandEvents.icon(type), summary: legacy().BunnylandEvents.eventSummary(type, ev, (id: string) => worldRef.current?.entities[id] ? entityName(worldRef.current.entities[id]!) : id), ...(actor ? { actorId: actor, actorName: worldRef.current?.entities[actor] ? entityName(worldRef.current.entities[actor]!) : actor } : {}) }; setEvents((items) => [...items.slice(-249), item]); refreshRef.current = window.setTimeout(async () => { const data = await sendAdmin('/admin/world/snapshot', { method: 'GET', prompt: false }); applyWorld(legacy().BunnylandWorld.parseApiSnapshot(data), { resetView: false }); }, 400); } }; ws.onclose = () => { if (wsRef.current === ws) disconnect(); }; ws.onerror = () => setApiStatus('error', '⚠ Connection failed'); }, [applyWorld, disconnect, sendAdmin, setApiStatus, syncUrl]);

  pushRef.current = push;
  disconnectRef.current = disconnect;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const runtime = legacy();
    const controller = new WorldGraphController({
      canvas,
      onSelectionChange: noteSelection,
      runtime,
      wrapper,
    }, ENTITY_STYLE);
    graphControllerRef.current = controller;
    return () => {
      controller.destroy();
      if (graphControllerRef.current === controller) graphControllerRef.current = null;
    };
  }, [noteSelection]);

  useLayoutEffect(() => { const facade = {} as InspectorFacade; Object.defineProperties(facade, {
    _apiBase: { configurable: true, get: () => apiBaseRef.current, set: (value: string | null) => { apiBaseRef.current = value; setApiBase(value); } },
    _sendAdmin: { configurable: true, get: () => sendAdminOverride.current || defaultSendAdmin, set: (value: InspectorFacade['_sendAdmin']) => { sendAdminOverride.current = value; } },
    _sendPatch: { configurable: true, get: () => sendPatchOverride.current || defaultSendPatch, set: (value: InspectorFacade['_sendPatch']) => { sendPatchOverride.current = value; } },
    lgraph: { configurable: true, get: () => graphControllerRef.current?.graph ?? null }, lgcanvas: { configurable: true, get: () => graphControllerRef.current?.canvas ?? null }, _nodeMap: { configurable: true, get: () => graphControllerRef.current?.nodes ?? {} }, world: { configurable: true, get: () => worldRef.current },
    loadSnapshot: { configurable: true, value: loadSnapshot }, selectEntity: { configurable: true, value: selectEntity }, setRootView: { configurable: true, value: setRootView },
    _applyWorld: { configurable: true, value: applyWorld }, _assignController: { configurable: true, value: assign }, _cloneEntityOperations: { configurable: true, value: cloneOps }, _deleteEntity: { configurable: true, value: remove }, _monitorRoom: { configurable: true, value: monitor }, _pushEntity: { configurable: true, value: push }, _setApiStatus: { configurable: true, value: setApiStatus }, _showContextMenu: { configurable: true, value: showMenu },
  }); legacy().app = facade;
    return () => { if (legacy().app === facade) delete legacy().app; disconnect(); };
  }, [applyWorld, assign, cloneOps, defaultSendAdmin, defaultSendPatch, disconnect, loadSnapshot, monitor, push, remove, selectEntity, setApiStatus, setRootView, showMenu]);

  useEffect(() => { const clientMenu = legacy().BunnylandUI.initClientMenu({ showOnFirstLoad: true }); const nav = parseDeepLink(); pendingRef.current = nav.view || nav.entity ? nav : null; void legacy().BunnylandUI.loadConfig().then((config) => { const server = nav.server || (typeof config?.serverUrl === 'string' ? config.serverUrl : ''); if (server) { apiBaseRef.current = server; setApiBase(server); } autoConnectRef.current = Boolean(nav.server || config?.autoConnect && server); if ((!liveAuthRef.current || liveAuthRef.current.authorized) && autoConnectRef.current) void connect(server); }); const onHash = () => { const next = parseDeepLink(); applyingHash.current = true; try { if (next.view && next.view !== viewRef.current) { viewRef.current = next.view; setView(next.view); stackRef.current = []; setStack([]); renderGraph(false); } selectedRef.current = next.entity; setSelectedId(next.entity); if (next.entity) selectEntity(next.entity); } finally { applyingHash.current = false; } }; window.addEventListener('hashchange', onHash); return () => { window.removeEventListener('hashchange', onHash); clientMenu?.close?.(); }; }, [connect, renderGraph, selectEntity]);
  useEffect(() => {
    if (liveAuth?.authorized && autoConnectRef.current && apiBaseRef.current && !wsRef.current) {
      void connect(apiBaseRef.current);
    }
  }, [connect, liveAuth?.authorized]);

  const hits = useMemo<InspectorSearchHit[]>(() => {
    const parsed = legacy().BunnylandWorld.parseEntitySearch(search);
    if (!world || (!parsed.text && !parsed.filters.length)) return [];
    return Object.values(world.entities).filter((entity) => {
      const name = entityName(entity), type = entityType(entity), components = Object.keys(entity.components);
      const hay = `${name} ${entity.id} ${type} ${components.join(' ')}`.toLowerCase();
      return (!parsed.text || hay.includes(parsed.text)) && parsed.filters.every(({ key, value }) => key === 'type' ? type.includes(value) : (key === 'component' || key === 'has') ? components.some((component) => component.toLowerCase().includes(value)) : hay.includes(value));
    }).slice(0, 15).map((entity) => ({ id: entity.id, name: entityName(entity), type: entityType(entity), icon: entityIcon(entity) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [search, world]);
  useEffect(() => { setSearchIndex(0); setSearchOpen(hits.length > 0); }, [hits]);

  const selected = selectedId && world?.entities[selectedId] || null, controllers = useMemo(() => world ? Object.values(world.entities).map((entity) => { const info = legacy().BunnylandWorld.controllerInfo(entity); return info ? { id: entity.id, label: `${info.icon} ${info.label}${info.detail ? ` · ${info.detail}` : ''} (${entity.id})` } : null; }).filter(Boolean) as Array<{ id: string; label: string }> : [], [world]);
  const worldDetails = world ? findWorldDetails(world.entities) : null;
  const pickSearch = (id: string) => { setSearch(''); setSearchOpen(false); selectEntity(id); };
  const onCanvasContext = (event: MouseEvent) => { const entityId = graphControllerRef.current?.entityAt(event.clientX, event.clientY); if (entityId) { event.preventDefault(); selectEntity(entityId); showMenu(entityId, event.clientX, event.clientY); } };
  const worldInfo = world ? [world.meta.seed && `seed: ${world.meta.seed}`, world.meta.generator && `gen: ${world.meta.generator}`, `epoch: ${world.epoch}s`, `entities: ${Object.keys(world.entities).length}`].filter(Boolean).join(' · ') : '';
  const runtimeText = !wsRef.current ? 'runtime: offline' : runtime.paused == null ? 'runtime: locked' : runtime.paused ? 'runtime: paused' : runtime.running ? 'runtime: playing' : 'runtime: stopped';
  const canGenerateRoom = Boolean(apiBase && world && Object.values(world.entities).some((entity) => entity.components.DoorComponent));
  const saveWorldDetails = async (details: WorldDetails): Promise<void> => {
    if (!worldDetails) throw new Error('World clock entity is missing');
    if (!apiBase) throw new Error('Connect to a live server before editing world details');
    await sendPatch([{
      op: 'set_component',
      entity_id: worldDetails.entityId,
      component: {
        type: 'WorldInfoComponent',
        fields: {
          content_flags: details.contentFlags,
          description: details.description,
          title: details.title,
        },
      },
    }], { status: '● World details saved' });
  };
  return <>
    <div id="toolbar"><div class="toolbar-row toolbar-heading" id="toolbar-row1"><span class="toolbar-brand"><img src="favicon.png" alt=""/> Bunnyland World Graph</span><button id="btn-client-menu" class="client-menu-button" type="button">Menu</button></div>
    <div class="toolbar-row" id="toolbar-row2"><label for="file-input">Snapshot:</label><input type="file" id="file-input" accept=".json" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void file.text().then((text) => loadSnapshot(JSON.parse(text))); }}/><span class="toolbar-sep">|</span><label for="api-url">Server:</label><input type="text" id="api-url" value={apiBase || '/api/v1/'} spellcheck={false} onInput={(event) => { apiBaseRef.current = event.currentTarget.value; setApiBase(event.currentTarget.value); }}/><button id="btn-connect" onClick={() => { if (!wsRef.current && liveAuth && !liveAuth.authorized) { liveAuth.request(); return; } if (wsRef.current) disconnect(); else void connect(apiBase || '/api/v1/'); }}>{wsRef.current ? 'Disconnect' : liveAuth && !liveAuth.authorized ? 'Login for Live' : 'Connect Live'}</button><span id="api-status" class={status.className}>{status.text}</span><button id="btn-toggle-runtime" disabled={!wsRef.current}>⏯</button><span id="runtime-status">{runtimeText}</span><button id="btn-back" disabled={!stack.length} onClick={() => { stackRef.current = stackRef.current.slice(0, -1); setStack(stackRef.current); renderGraph(true); }}>← Back</button><span id="search-box"><input type="text" id="search-input" value={search} placeholder="🔍 find, type:, component:" spellcheck={false} autocomplete="off" onInput={(event) => setSearch(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'ArrowDown') setSearchIndex(Math.min(hits.length - 1, searchIndex + 1)); else if (event.key === 'ArrowUp') setSearchIndex(Math.max(0, searchIndex - 1)); else if (event.key === 'Enter' && hits[searchIndex]) pickSearch(hits[searchIndex]!.id); else if (event.key === 'Escape') setSearchOpen(false); }}/><div id="search-results" class={searchOpen ? '' : 'hidden'}><SearchHits hits={hits} activeIndex={searchIndex} onPick={pickSearch}/></div></span></div>
    <div class="toolbar-row" id="toolbar-row3"><span id="view-switch">{(['map', 'region', 'social', 'quest'] as View[]).map((item) => <button id={`btn-view-${item}`} class={view === item ? 'active' : ''} key={item} onClick={() => setRootView(item)}>{item === 'map' ? '🗺 Map' : item === 'region' ? '🌐 Regions' : item === 'social' ? '👥 Social' : '📜 Quests'}</button>)}</span><button id="btn-generate-room" disabled={!canGenerateRoom} title={!apiBase ? 'Connect to a live server to generate rooms' : !canGenerateRoom ? 'Add a door before generating a room' : 'Generate a room through an existing door'} onClick={() => { void generateRoom(); }}>✨ Add Room</button><label id="parents-toggle"><input type="checkbox" id="toggle-parents" checked={showParents} onChange={(event) => { showParentsRef.current = event.currentTarget.checked; setShowParents(event.currentTarget.checked); renderGraph(true); }}/> parent nodes</label><label id="events-toggle"><input type="checkbox" id="toggle-events" checked={showEvents} onChange={(event) => setShowEvents(event.currentTarget.checked)}/> events</label><span class="toolbar-sep">|</span><span id="breadcrumb">{stack.length > 0 ? <button class="crumb" data-inspector-root onClick={() => setRootView(view)}>{rootLabel()}</button> : <span class="crumb-current">{rootLabel()}</span>}{stack.map((crumb, index) => <span key={crumb.entityId}> › {index === stack.length - 1 ? <span class="crumb-current">{crumb.label}</span> : <button class="crumb" data-inspector-depth={index} onClick={() => { stackRef.current = stackRef.current.slice(0, index + 1); setStack(stackRef.current); renderGraph(true); }}>{crumb.label}</button>}</span>)}</span><span id="world-info">{worldInfo}</span></div>
    <div class="toolbar-row world-details-row" id="toolbar-row4"><WorldDetailsEditor disabled={!apiBase} idPrefix="inspector" onSave={saveWorldDetails} target={worldDetails}/></div></div>
    <div id="main" class="app-split"><div id="graph-wrapper" ref={wrapperRef} onContextMenu={onCanvasContext} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer?.files[0]; if (file) void file.text().then((text) => loadSnapshot(JSON.parse(text))); }}><canvas id="graph-canvas" ref={canvasRef}/><div id="social-legend" class={view === 'social' ? '' : 'hidden'}>{socialTypes.length ? <><div class="leg-title">Relationships</div>{socialTypes.map((type) => <span class="leg-item" key={type}><span class="leg-swatch" style={{ background: SOCIAL_EDGES[type]!.color }}/>{SOCIAL_EDGES[type]!.label}</span>)}</> : <div class="leg-title">No relationships in this world</div>}</div>{menu && <ContextMenu entity={world?.entities[menu.entityId] || null} apiBase={apiBase} controllers={controllers} left={menu.left} top={menu.top} onClose={() => setMenu(null)} onAssign={assign} onClone={(id: string) => void sendPatch(cloneOps(id), { status: '● Entity cloned' })} onDelete={remove} onGenerate={generateEntity} onMonitor={monitor}/>}<div id="drop-overlay" class={world ? 'hidden' : ''}><div class="title">🐰 Bunnyland World Graph</div><div>Load a world snapshot JSON to begin</div><div class="hint">Load a .json file, drag &amp; drop here, or Connect Live to a running server</div></div></div><div id="sidebar"><div id="inspector"><EntityInspector apiBase={apiBase} entity={selected} moved={Boolean(selectedId && movedRef.current[selectedId] != null && world && world.epoch - movedRef.current[selectedId]! <= 60)} onSelect={selectEntity} world={world}/></div><div id="event-panel" class={showEvents ? '' : 'hidden'}><div id="event-panel-header"><span class="ev-title">⚡ Events</span><span id="event-count">{events.length ? `(${events.length})` : ''}</span><button id="event-clear" onClick={() => setEvents([])}>clear</button></div><div id="event-list"><EventFeed events={events}/></div></div></div></div>
  </>;
}

interface ContextMenuProps {
  apiBase: string | null;
  controllers: Array<{ id: string; label: string }>;
  entity: Entity | null;
  left: number;
  onAssign: (entityId: string, controllerId: string) => Promise<void>;
  onClone: (entityId: string) => void;
  onClose: () => void;
  onDelete: (entityId: string) => Promise<void>;
  onGenerate: (kind: GenerationKind, targetId: string) => Promise<void>;
  onMonitor: (entityId: string) => Promise<void>;
  top: number;
}

function ContextMenu({ apiBase, controllers, entity, left, onAssign, onClone, onClose, onDelete, onGenerate, onMonitor, top }: ContextMenuProps) {
  const [controller, setController] = useState(entity?.relationships.ControlledBy?.[0]?.target || controllers[0]?.id || ''); if (!entity) return null;
  const editor = new URL('world-editor.html', location.href); if (apiBase) editor.searchParams.set('server', apiBase); editor.hash = encodeURIComponent(entity.id);
  return <div id="graph-context-menu" style={{ left, top }} onMouseLeave={onClose}><div class="graph-menu-title">{entityName(entity)}</div><button type="button" class="graph-menu-item" data-menu-action="edit" onClick={() => { location.href = editor.toString(); }}>Edit in World Editor</button>{Boolean(entity.components.RoomComponent) && <><div class="graph-menu-sep"/><button type="button" class="graph-menu-item" data-menu-action="generate-character" disabled={!apiBase} onClick={() => { void onGenerate('character', entity.id); }}>✨ Add Character</button><button type="button" class="graph-menu-item" data-menu-action="generate-item" disabled={!apiBase} onClick={() => { void onGenerate('item', entity.id); }}>✨ Add Item</button></>}<div class="graph-menu-sep"/><button type="button" class="graph-menu-item" data-menu-action="monitor-room" disabled={!apiBase || !entity.components.RoomComponent || Boolean(entity.components.DiscordRoomFeedComponent)} onClick={() => { void onMonitor(entity.id); }}>Monitor Room</button><select class="graph-menu-select" data-controller-select disabled={!apiBase || !entity.components.CharacterComponent || !controllers.length} value={controller} onChange={(event) => setController(event.currentTarget.value)}>{controllers.length ? controllers.map((option) => <option key={option.id} value={option.id}>{option.label}</option>) : <option value="">No controllers</option>}</select><button type="button" class="graph-menu-item" data-menu-action="assign" disabled={!apiBase || !controller} onClick={() => { void onAssign(entity.id, controller); }}>Assign Controller</button><button type="button" class="graph-menu-item" data-menu-action="delete" disabled={!apiBase} onClick={() => { void onDelete(entity.id); }}>Remove from World</button><button type="button" class="graph-menu-item" data-menu-action="clone" disabled={!apiBase} onClick={() => onClone(entity.id)}>Clone Entity</button></div>;
}

const root = document.getElementById('app');
if (root) {
  const base = legacy().BunnylandApi.serverFromUrl() || '/api/v1';
  function InspectorEntry() {
    const { hasScopes, openLogin, status } = useAuth();
    const authorized = status === 'authenticated' && hasScopes(['world:admin']);
    const request = useCallback((): void => openLogin(['world:admin']), [openLogin]);
    const liveAuth = useMemo<LiveAuth>(() => ({
      authorized,
      request,
    }), [authorized, request]);
    return <InspectorApp liveAuth={liveAuth} />;
  }
  render(<AuthProvider base={base}><InspectorEntry /></AuthProvider>, root);
}
