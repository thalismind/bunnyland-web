export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonObject | JsonPrimitive | JsonValue[];
export interface JsonObject { [key: string]: JsonValue }

export interface WorldEdge {
  edge: JsonObject;
  target: string;
}

export interface WorldEntity {
  components: Record<string, JsonObject>;
  created_epoch: number;
  id: string;
  prefab: string;
  relationships: Record<string, WorldEdge[]>;
}

export interface EditorWorld {
  entities: Record<string, WorldEntity>;
  meta: JsonObject;
  metadata: JsonObject & { epoch: number };
}

export interface JsonSchema {
  $defs?: Record<string, JsonSchema>;
  $ref?: string;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  const?: JsonValue;
  default?: JsonValue;
  description?: string;
  enum?: JsonValue[];
  format?: string;
  items?: JsonSchema | JsonSchema[];
  maxLength?: number;
  maximum?: number;
  minLength?: number;
  minimum?: number;
  multipleOf?: number;
  oneOf?: JsonSchema[];
  pattern?: string;
  prefixItems?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  readOnly?: boolean;
  title?: string;
  type?: string;
}

export interface EditorFieldSchema extends JsonSchema {
  nullable?: boolean;
  unsupportedUnion?: boolean;
}

export interface CatalogueEntry { json_schema: JsonSchema | undefined }
export interface WorldCatalogue {
  components: Record<string, CatalogueEntry>;
  edges: Record<string, CatalogueEntry>;
}

export interface ComponentPatchValue { fields: JsonObject; type: string }
export interface EdgePatchValue { fields: JsonObject; type: string }

export type PatchOperation =
  | { client_id?: string; components?: ComponentPatchValue[]; op: 'add_entity'; prefab?: string }
  | { component: ComponentPatchValue; entity_id: string; op: 'add_component' | 'set_component' }
  | { component_type: string; entity_id: string; op: 'remove_component' }
  | { entity_id: string; op: 'delete_entity' }
  | { edge: EdgePatchValue; op: 'set_edge'; source_id: string; target_id: string }
  | { edge_type: string; op: 'remove_edge'; source_id: string; target_id: string };

export interface WorldFragment {
  attach_edge?: EdgePatchValue;
  id: string;
  kind: string;
  operations: PatchOperation[];
  root_client_id?: string;
  schema_version: number;
  source: string;
  title: string;
}

export interface RuntimeState {
  paused: boolean | null;
  running: boolean;
  world_epoch?: number;
}

export interface PatchResult {
  changed_entities: WorldEntity[];
  deleted_entities: string[];
  saved_at_epoch?: number;
  world_epoch?: number;
}

export interface ValidationProblem { entityId?: string; message: string }
export interface EntitySearch {
  filters: Array<{ key: string; value: string }>;
  invalid: boolean;
  text: string;
}

const DEFAULT_KIND_ICONS: Record<string, string> = {
  character: '🐰', clock: '◷', container: '📦', door: '🚪', item: '✦', objective: '◻',
  other: '⬡', quest: '📜', region: '🌐', reward: '🎁', room: '🏠',
};

export const COMMON_COMPONENTS = [
  'ActionPointsComponent', 'CharacterComponent', 'ContainerComponent', 'DescriptionComponent',
  'DiscordControllerComponent', 'DoorComponent', 'EditorDisplayComponent', 'FocusPointsComponent',
  'IdentityComponent', 'InitiativeComponent', 'LLMControllerComponent', 'LockableComponent',
  'PortableComponent', 'RoomComponent', 'SuspendedComponent', 'SuspendedControllerComponent', 'WorldClockComponent',
];
export const COMMON_EDGES = ['Contains', 'ControlledBy', 'ExitTo', 'HasThought', 'Holding', 'Wearing'];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

export function jsonObject(value: unknown, label = 'value'): JsonObject {
  if (!isRecord(value) || !isJsonValue(value)) throw new Error(`${label} must be a JSON object`);
  return value;
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function numberField(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringField(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function parseFields(value: unknown, label: string): JsonObject {
  return value == null ? {} : jsonObject(value, label);
}

function emptyEntity(id: string): WorldEntity {
  return { id, prefab: 'entity', created_epoch: 0, components: {}, relationships: {} };
}

function parseSavedEdge(value: unknown, label: string): WorldEdge {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const target = stringField(value.target);
  if (!target) throw new Error(`${label}.target must be a string`);
  return { target, edge: parseFields(value.edge, `${label}.edge`) };
}

export function parseApiEntity(value: unknown): WorldEntity {
  if (!isRecord(value)) throw new Error('API entity must be an object');
  const id = stringField(value.id);
  if (!id) throw new Error('API entity id must be a non-empty string');
  const entity = emptyEntity(id);
  entity.prefab = stringField(value.prefab, 'entity');
  entity.created_epoch = numberField(value.created_epoch);
  if (value.components != null) {
    if (!isRecord(value.components)) throw new Error(`entity ${id} components must be an object`);
    for (const [type, fields] of Object.entries(value.components)) entity.components[type] = parseFields(fields, `${id}.${type}`);
  }
  if (value.relationships != null) {
    if (!isRecord(value.relationships)) throw new Error(`entity ${id} relationships must be an object`);
    for (const [type, edges] of Object.entries(value.relationships)) {
      if (!Array.isArray(edges)) throw new Error(`${id}.${type} relationships must be an array`);
      entity.relationships[type] = edges.map((edge, index) => {
        if (!isRecord(edge)) throw new Error(`${id}.${type}[${index}] must be an object`);
        const target = stringField(edge.target_id || edge.target);
        if (!target) throw new Error(`${id}.${type}[${index}] target must be a string`);
        return { target, edge: parseFields(edge.edge, `${id}.${type}[${index}].edge`) };
      });
    }
  }
  return entity;
}

function parseApiSnapshot(value: Record<string, unknown>): EditorWorld {
  if (!Array.isArray(value.entities)) throw new Error('API snapshot entities must be an array');
  const entities: Record<string, WorldEntity> = {};
  for (const raw of value.entities) {
    const entity = parseApiEntity(raw);
    if (entities[entity.id]) throw new Error(`duplicate entity ${entity.id}`);
    entities[entity.id] = entity;
  }
  const epoch = numberField(value.world_epoch);
  return {
    entities,
    metadata: { version: '1.0', epoch },
    meta: value.metadata == null ? {} : parseFields(value.metadata, 'snapshot metadata'),
  };
}

function parseSavedSnapshot(value: Record<string, unknown>): EditorWorld {
  if (value.entities != null && !isRecord(value.entities)) throw new Error('saved world entities must be an object');
  const entities: Record<string, WorldEntity> = {};
  for (const [id, raw] of Object.entries(value.entities || {})) {
    if (!isRecord(raw)) throw new Error(`saved entity ${id} must be an object`);
    const entity = emptyEntity(id);
    entity.prefab = stringField(raw.prefab, 'entity');
    entity.created_epoch = numberField(raw.created_epoch);
    if (isRecord(raw.components)) {
      for (const [type, fields] of Object.entries(raw.components)) entity.components[type] = parseFields(fields, `${id}.${type}`);
    }
    if (isRecord(raw.relationships)) {
      for (const [type, edges] of Object.entries(raw.relationships)) {
        if (!Array.isArray(edges)) throw new Error(`${id}.${type} relationships must be an array`);
        entity.relationships[type] = edges.map((edge, index) => parseSavedEdge(edge, `${id}.${type}[${index}]`));
      }
    }
    entities[id] = entity;
  }
  for (const [tableName, destination] of [['components', 'components'], ['relationships', 'relationships']] as const) {
    const tables = value[tableName];
    if (tables == null) continue;
    if (!isRecord(tables)) throw new Error(`${tableName} must be an object`);
    for (const [type, table] of Object.entries(tables)) {
      if (!isRecord(table)) throw new Error(`${tableName}.${type} must be an object`);
      for (const [id, raw] of Object.entries(table)) {
        const entity = entities[id] ||= emptyEntity(id);
        if (destination === 'components') entity.components[type] = parseFields(raw, `${type}.${id}`);
        else {
          if (!Array.isArray(raw)) throw new Error(`${type}.${id} must be an array`);
          entity.relationships[type] = raw.map((edge, index) => parseSavedEdge(edge, `${type}.${id}[${index}]`));
        }
      }
    }
  }
  const rawMetadata = value.metadata == null ? {} : parseFields(value.metadata, 'metadata');
  const rawMeta = value.bunnyland == null ? (value.meta == null ? {} : parseFields(value.meta, 'meta')) : parseFields(value.bunnyland, 'bunnyland');
  const epoch = numberField(rawMetadata.epoch, numberField(rawMeta.saved_at_epoch));
  return { entities, metadata: { ...rawMetadata, version: stringField(rawMetadata.version, '1.0'), epoch }, meta: rawMeta };
}

export function parseWorld(value: unknown): EditorWorld {
  if (!isRecord(value)) throw new Error('world must be a JSON object');
  return Array.isArray(value.entities) ? parseApiSnapshot(value) : parseSavedSnapshot(value);
}

export function emptyWorld(): EditorWorld {
  return parseWorld({
    metadata: { version: '1.0', epoch: 0 },
    bunnyland: { schema_version: 1, seed: '', prompt: '', generator: '', plugins: [], saved_at_epoch: 0, saved_at: null },
    entities: { entity_1: { prefab: 'entity', created_epoch: 0 } },
    components: {
      WorldClockComponent: { entity_1: { game_time_seconds: 0, tick_index: 0, time_scale: 1 } },
      WorldInfoComponent: { entity_1: { title: '', description: '', content_flags: [] } },
    },
  });
}

export function exportWorld(world: EditorWorld): JsonObject {
  const components: JsonObject = {};
  const relationships: JsonObject = {};
  const entities: JsonObject = {};
  for (const entity of Object.values(world.entities)) {
    entities[entity.id] = { prefab: entity.prefab || 'entity', created_epoch: Number(entity.created_epoch || 0) };
    for (const [type, fields] of Object.entries(entity.components)) {
      const table = isRecord(components[type]) ? components[type] : {};
      table[entity.id] = cloneJson(fields);
      components[type] = table as JsonObject;
    }
    for (const [type, edges] of Object.entries(entity.relationships)) {
      const clean = edges.filter(edge => edge.target).map(edge => ({ target: edge.target, edge: cloneJson(edge.edge) }));
      if (!clean.length) continue;
      const table = isRecord(relationships[type]) ? relationships[type] : {};
      table[entity.id] = clean;
      relationships[type] = table as JsonObject;
    }
  }
  const epoch = numberField(world.metadata.epoch);
  const meta: JsonObject = {
    schema_version: 1, seed: '', prompt: '', generator: '', plugins: [], saved_at_epoch: epoch, saved_at: null,
    ...cloneJson(world.meta),
  };
  meta.saved_at_epoch = epoch;
  return {
    metadata: { ...cloneJson(world.metadata), version: stringField(world.metadata.version, '1.0'), epoch },
    bunnyland: meta,
    prefabs: { entity: { components: {} } }, entities, components, relationships, relics: [],
  };
}

export function entityType(entity: WorldEntity): string {
  const components = entity.components;
  if (components.RegionComponent) return 'region';
  if (components.RoomComponent) return 'room';
  if (components.CharacterComponent) return 'character';
  if (components.DoorComponent) return 'door';
  if (components.QuestComponent) return 'quest';
  if (components.QuestObjectiveComponent) return 'objective';
  if (components.QuestRewardComponent) return 'reward';
  if (components.ContainerComponent) return 'container';
  if (components.PortableComponent) return 'item';
  if (components.WorldClockComponent) return 'clock';
  return 'other';
}

function componentText(entity: WorldEntity, type: string, field: string): string {
  const value = entity.components[type]?.[field];
  return typeof value === 'string' ? value : '';
}

export function entityDisplayName(entity: WorldEntity): string {
  return componentText(entity, 'RegionComponent', 'name')
    || componentText(entity, 'RoomComponent', 'title')
    || componentText(entity, 'QuestComponent', 'title')
    || componentText(entity, 'QuestComponent', 'quest_id')
    || componentText(entity, 'QuestObjectiveComponent', 'description')
    || componentText(entity, 'QuestRewardComponent', 'description')
    || componentText(entity, 'IdentityComponent', 'name')
    || entity.id;
}

export function entityIcon(entity: WorldEntity): string {
  const emoji = componentText(entity, 'EditorDisplayComponent', 'emoji');
  const kind = componentText(entity, 'IdentityComponent', 'kind');
  return emoji || DEFAULT_KIND_ICONS[kind] || DEFAULT_KIND_ICONS[entityType(entity)] || '⬡';
}

export function catalogueNames(world: EditorWorld, kind: 'components' | 'relationships', defaults: readonly string[]): string[] {
  const names = new Set(defaults);
  for (const entity of Object.values(world.entities)) for (const name of Object.keys(entity[kind])) names.add(name);
  return [...names].sort();
}

export function parseEntitySearch(query: string): EntitySearch {
  const filters: EntitySearch['filters'] = [];
  const text: string[] = [];
  for (const token of query.trim().split(/\s+/).filter(Boolean)) {
    const match = token.match(/^([a-z]+):(.*)$/i);
    if (match?.[1] != null && match[2] != null) filters.push({ key: match[1].toLowerCase(), value: match[2].toLowerCase() });
    else text.push(token.toLowerCase());
  }
  const invalid = text.includes('invalid');
  return { filters, invalid, text: (invalid ? text.filter(token => token !== 'invalid') : text).join(' ') };
}

export function hasInvalidTarget(entity: WorldEntity, world: EditorWorld): boolean {
  return Object.values(entity.relationships).some(edges => edges.some(edge => Boolean(edge.target) && !world.entities[edge.target]));
}

export function filterEntities(world: EditorWorld, query: string): WorldEntity[] {
  const parsed = parseEntitySearch(query);
  return Object.values(world.entities).sort((a, b) => entityDisplayName(a).localeCompare(entityDisplayName(b))).filter(entity => {
    const components = Object.keys(entity.components);
    const type = entityType(entity);
    const name = entityDisplayName(entity);
    const haystack = `${name} ${entity.id} ${type} ${components.join(' ')}`.toLowerCase();
    if (parsed.invalid && !hasInvalidTarget(entity, world)) return false;
    if (parsed.text && !haystack.includes(parsed.text)) return false;
    return parsed.filters.every(({ key, value }) => key === 'type' ? type.includes(value)
      : key === 'id' ? entity.id.toLowerCase().includes(value)
      : key === 'name' ? name.toLowerCase().includes(value)
      : key === 'component' || key === 'has' ? components.some(component => component.toLowerCase().includes(value))
      : key === 'missing' ? !components.some(component => component.toLowerCase().includes(value))
      : haystack.includes(`${key}:${value}`));
  });
}

export function parseCatalogue(value: unknown): WorldCatalogue {
  if (!isRecord(value)) throw new Error('catalogue must be an object');
  const parseEntries = (raw: unknown, label: string): Record<string, CatalogueEntry> => {
    if (!isRecord(raw)) throw new Error(`${label} must be an object`);
    const entries: Record<string, CatalogueEntry> = {};
    for (const [name, entry] of Object.entries(raw)) {
      if (!isRecord(entry)) throw new Error(`${label}.${name} must be an object`);
      entries[name] = { json_schema: entry.json_schema == null ? undefined : parseJsonSchema(entry.json_schema, `${label}.${name}.json_schema`) };
    }
    return entries;
  };
  return { components: parseEntries(value.components, 'components'), edges: parseEntries(value.edges, 'edges') };
}

function parseJsonSchema(value: unknown, label: string): JsonSchema {
  if (!isRecord(value) || !isJsonValue(value)) throw new Error(`${label} must be a JSON object`);
  return value as JsonSchema;
}

function parsePatchOperation(value: unknown, label: string): PatchOperation {
  if (!isRecord(value) || typeof value.op !== 'string') throw new Error(`${label} must have an operation name`);
  if (!isJsonValue(value)) throw new Error(`${label} must contain JSON values`);
  return value as PatchOperation;
}

export function normalizeFragments(value: unknown, source: string): WorldFragment[] {
  if (!isRecord(value)) throw new Error('fragment data must be an object');
  const raw = Array.isArray(value.fragments) ? value.fragments : [value];
  return raw.flatMap((item, index) => {
    if (!isRecord(item) || !Array.isArray(item.operations)) return [];
    const id = stringField(item.id, `${source}/fragment-${index + 1}`);
    const fragment: WorldFragment = {
      id,
      title: stringField(item.title, id || `Fragment ${index + 1}`),
      kind: stringField(item.kind, 'fragment'),
      schema_version: numberField(item.schema_version, 1),
      operations: item.operations.map((operation, operationIndex) => parsePatchOperation(operation, `fragment ${id} operation ${operationIndex}`)),
      source,
    };
    if (typeof item.root_client_id === 'string') fragment.root_client_id = item.root_client_id;
    if (isRecord(item.attach_edge)) {
      const type = stringField(item.attach_edge.type);
      if (!type) throw new Error(`fragment ${id} attach edge type is required`);
      fragment.attach_edge = { type, fields: parseFields(item.attach_edge.fields, `fragment ${id} attach edge fields`) };
    }
    return [fragment];
  });
}

export function parseRuntimeState(value: unknown): RuntimeState {
  if (!isRecord(value)) throw new Error('runtime response must be an object');
  const state: RuntimeState = { paused: value.paused == null ? null : Boolean(value.paused), running: Boolean(value.running) };
  if (value.world_epoch != null) state.world_epoch = numberField(value.world_epoch);
  return state;
}

export function parsePatchResult(value: unknown): PatchResult {
  if (!isRecord(value)) throw new Error('patch response must be an object');
  if (value.changed_entities != null && !Array.isArray(value.changed_entities)) throw new Error('changed_entities must be an array');
  if (value.deleted_entities != null && !Array.isArray(value.deleted_entities)) throw new Error('deleted_entities must be an array');
  const result: PatchResult = {
    changed_entities: (value.changed_entities || []).map(parseApiEntity),
    deleted_entities: (value.deleted_entities || []).map((id, index) => {
      if (typeof id !== 'string') throw new Error(`deleted_entities[${index}] must be a string`);
      return id;
    }),
  };
  if (value.world_epoch != null) result.world_epoch = numberField(value.world_epoch);
  if (value.saved_at_epoch != null) result.saved_at_epoch = numberField(value.saved_at_epoch);
  return result;
}

export function applyLocalPatch(world: EditorWorld, operations: PatchOperation[]): string[] {
  const aliases: Record<string, string> = {};
  const created: string[] = [];
  const resolve = (id: string): string => aliases[id] || (world.entities[id] ? id : (() => { throw new Error(`entity ${id} does not exist`); })());
  for (const operation of operations) {
    if (operation.op === 'add_entity') {
      let index = Object.keys(world.entities).length + 1;
      while (world.entities[`entity_${index}`]) index += 1;
      const id = `entity_${index}`;
      if (operation.client_id) aliases[operation.client_id] = id;
      created.push(id);
      world.entities[id] = {
        id, prefab: operation.prefab || 'entity', created_epoch: Number(world.metadata.epoch || 0),
        components: Object.fromEntries((operation.components || []).map(component => [component.type, cloneJson(component.fields)])), relationships: {},
      };
    } else if (operation.op === 'set_edge') {
      const source = resolve(operation.source_id);
      const target = resolve(operation.target_id);
      const sourceEntity = world.entities[source];
      if (!sourceEntity) throw new Error(`entity ${source} does not exist`);
      const edges = sourceEntity.relationships[operation.edge.type] ||= [];
      edges.push({ target, edge: cloneJson(operation.edge.fields) });
    } else if (operation.op === 'add_component' || operation.op === 'set_component') {
      const entity = world.entities[resolve(operation.entity_id)];
      if (entity) entity.components[operation.component.type] = cloneJson(operation.component.fields);
    } else throw new Error(`unsupported offline fragment operation ${operation.op}`);
  }
  return created;
}

export function validateWorld(snapshot: JsonObject): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const entities = isRecord(snapshot.entities) ? snapshot.entities : {};
  const ids = new Set(Object.keys(entities));
  const components = isRecord(snapshot.components) ? snapshot.components : {};
  const clocks = isRecord(components.WorldClockComponent) ? Object.keys(components.WorldClockComponent) : [];
  if (clocks.length !== 1) problems.push({ message: `expected exactly one WorldClockComponent, found ${clocks.length}` });
  const relationships = isRecord(snapshot.relationships) ? snapshot.relationships : {};
  for (const [type, rawTable] of Object.entries(relationships)) {
    if (!isRecord(rawTable)) continue;
    for (const [source, rawEdges] of Object.entries(rawTable)) {
      if (!ids.has(source)) problems.push({ message: `${type}: source ${source} does not exist` });
      if (!Array.isArray(rawEdges)) continue;
      for (const rawEdge of rawEdges) if (isRecord(rawEdge) && typeof rawEdge.target === 'string' && !ids.has(rawEdge.target)) {
        problems.push({ entityId: source, message: `${type}: ${source} targets missing entity ${rawEdge.target}` });
      }
    }
  }
  return problems;
}
