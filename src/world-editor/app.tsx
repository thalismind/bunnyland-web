/* eslint-disable @typescript-eslint/no-explicit-any */
import { render } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { EntityList } from './entity-list';

type Json = Record<string, any>;
type Entity = { components: Json; created_epoch?: number; id: string; prefab?: string; relationships: Record<string, any[]> };
type World = { entities: Record<string, Entity>; meta: Json; metadata: Json };
type Status = { kind: string; text: string };

const globals = globalThis as typeof globalThis & { BunnylandApi: any; BunnylandUI: any; BunnylandWorld: any };
const api = globals.BunnylandApi;
const ui = globals.BunnylandUI;
const worldApi = globals.BunnylandWorld;
const COMMON_COMPONENTS = [
  'ActionPointsComponent', 'CharacterComponent', 'ContainerComponent', 'DescriptionComponent',
  'DiscordControllerComponent', 'DoorComponent', 'EditorDisplayComponent', 'FocusPointsComponent',
  'IdentityComponent', 'InitiativeComponent', 'LLMControllerComponent', 'LockableComponent',
  'PortableComponent', 'RoomComponent', 'SuspendedComponent', 'SuspendedControllerComponent', 'WorldClockComponent',
];
const COMMON_EDGES = ['Contains', 'ControlledBy', 'ExitTo', 'HasThought', 'Holding', 'Wearing'];

const clone = <T,>(value: T): T => ui.cloneJson(value);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
function emptyWorld(): World {
  return {
    metadata: { version: '1.0', epoch: 0 },
    meta: { schema_version: 1, seed: '', prompt: '', generator: '', plugins: [], saved_at_epoch: 0, saved_at: null },
    entities: { entity_1: {
      id: 'entity_1', prefab: 'entity', created_epoch: 0,
      components: { WorldClockComponent: { game_time_seconds: 0, tick_index: 0, time_scale: 1 } }, relationships: {},
    } },
  };
}
function parseObject(text: string) {
  const value = JSON.parse(text || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object');
  return value;
}
function resolveRef(schema: Json, root: Json) {
  const prefix = '#/$defs/';
  if (!schema?.$ref?.startsWith(prefix)) return schema || {};
  const target = root?.$defs?.[schema.$ref.slice(prefix.length)];
  if (!target) return schema;
  const siblings = { ...schema };
  delete siblings.$ref;
  return { ...target, ...siblings };
}
function variants(schema: Json) { return Array.isArray(schema?.anyOf) ? schema.anyOf : Array.isArray(schema?.oneOf) ? schema.oneOf : null; }
function fieldSchema(schema: Json, root: Json) {
  const resolved = resolveRef(schema, root); const choices = variants(resolved);
  const concrete = choices?.filter((item: Json) => resolveRef(item, root).type !== 'null') ?? [];
  const field = { ...resolveRef(choices && concrete.length === 1 ? concrete[0] : resolved, root) };
  for (const key of ['default', 'title', 'description']) {
    if (Object.prototype.hasOwnProperty.call(resolved, key)) field[key] = resolved[key];
    if (Object.prototype.hasOwnProperty.call(schema || {}, key)) field[key] = schema[key];
  }
  if (choices) { field.nullable = choices.some((item: Json) => resolveRef(item, root).type === 'null'); field.unsupportedUnion = concrete.length !== 1; }
  return field;
}
function enumOptions(schema: Json, root: Json): any[] {
  const resolved = resolveRef(schema, root);
  if (Array.isArray(resolved.enum)) return resolved.enum;
  if (Object.prototype.hasOwnProperty.call(resolved, 'const')) return [resolved.const];
  const choices = variants(resolved); if (!choices) return [];
  return choices.flatMap((item: Json) => item.type === 'null' ? [] : enumOptions(item, root))
    .filter((item: any, index: number, all: any[]) => all.findIndex(value => JSON.stringify(value) === JSON.stringify(item)) === index);
}
function defaultFor(schema: Json, root: Json): any {
  const field = fieldSchema(schema, root);
  if (Object.prototype.hasOwnProperty.call(field, 'default')) return clone(field.default);
  if (field.unsupportedUnion) return null;
  const options = enumOptions(field, root); if (options.length) return options[0];
  if (field.type === 'boolean') return false;
  if (field.type === 'integer' || field.type === 'number') return 0;
  if (field.type === 'array') return [];
  if (field.type === 'object') return {};
  return '';
}
function typedValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, schema: Json) {
  if (schema.type === 'boolean') return (input as HTMLInputElement).checked;
  if (schema.type === 'integer') return input.value === '' ? 0 : parseInt(input.value, 10);
  if (schema.type === 'number') return input.value === '' ? 0 : Number(input.value);
  if (schema.type === 'array' || schema.type === 'object' || schema.unsupportedUnion) return JSON.parse(input.value || (schema.type === 'array' ? '[]' : schema.type === 'object' ? '{}' : 'null'));
  const options = enumOptions(schema, schema); return options.find(value => String(value) === input.value) ?? input.value;
}
function parseFocusHash() {
  try {
    const parts = (location.hash.replace(/^#/, '').split('?').at(0) ?? '').split('/').filter(Boolean).map(decodeURIComponent);
    return parts.length > 1 ? parts.slice(1).join('/') : parts[0] || '';
  } catch { return ''; }
}

function SearchDropdown({ disabled = false, dropdownId, id, options, placeholder, value = '' }: {
  disabled?: boolean; dropdownId: string; id: string; options: { label: string; value: string }[]; placeholder: string; value?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null); const serialized = JSON.stringify(options);
  useLayoutEffect(() => { if (ref.current) ui.bindSearchDropdown(ref.current, { options, value }); }, [serialized, value]);
  const selected = options.find(option => option.value === value);
  return <span class="search-dropdown" id={dropdownId} ref={ref}>
    <input class="search-dropdown-input" type="text" defaultValue={selected?.label ?? ''} placeholder={placeholder} spellcheck={false} autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" disabled={disabled}
      onInput={() => { const hidden = ref.current?.querySelector<HTMLInputElement>('.search-dropdown-value'); if (hidden) hidden.value = ''; }}
      onKeyDown={event => { if (event.key !== 'Enter') return; const query = event.currentTarget.value.trim().toLowerCase(); const item = options.find(option => option.label.toLowerCase().includes(query) || option.value.toLowerCase().includes(query)); const hidden = ref.current?.querySelector<HTMLInputElement>('.search-dropdown-value'); if (item && hidden) { hidden.value = item.value; event.currentTarget.value = item.label; } }} />
    <input class="search-dropdown-value" id={id} type="hidden" value={selected?.value ?? ''} />
    <div class="search-dropdown-menu hidden" />
  </span>;
}

function InlineInput({ schema, value, onChange, ...data }: any) {
  const commit = (event: Event) => { try { onChange(typedValue(event.currentTarget as any, schema)); } catch { (event.currentTarget as HTMLElement).classList.add('bad-json'); } };
  if (schema.type === 'boolean') return <input {...data} data-inline-kind="boolean" type="checkbox" checked={Boolean(value)} onChange={commit} />;
  if (schema.type === 'integer' || schema.type === 'number') return <input {...data} data-inline-kind={schema.type} type="number" min={schema.minimum} max={schema.maximum} step={schema.multipleOf ?? (schema.type === 'integer' ? 1 : 'any')} value={value ?? ''} onInput={commit} />;
  if (schema.type === 'array' || schema.type === 'object') return <textarea {...data} data-inline-kind={schema.type} spellcheck={false} value={JSON.stringify(value ?? (schema.type === 'array' ? [] : {}))} onInput={commit} />;
  return <input {...data} data-inline-kind="string" type="text" list={schema.format === 'bunnyland-entity-id' ? 'entity-options' : undefined} value={value ?? ''} spellcheck={false} onInput={commit} />;
}

function FieldLabel({ name, nullable, nullValue, description, title, onNull }: any) {
  return nullable ? <span class="field-label"><span>{title}{description && <span class="field-description" title={description}>{description}</span>}</span><span class="nullable-choice"><input class="nullable-toggle" data-field={name} type="checkbox" checked={nullValue} onChange={event => onNull(event.currentTarget.checked)} /> null</span></span>
    : <>{title}{description && <span class="field-description" title={description}>{description}</span>}</>;
}

function SchemaField({ classPrefix, name, onChange, rawSchema, root, value, worldEpoch }: any) {
  const schema = fieldSchema(rawSchema, root); const title = schema.title || name; const isNull = schema.nullable && value == null;
  const label = <FieldLabel name={name} nullable={schema.nullable} nullValue={isNull} description={schema.description} title={title} onNull={(checked: boolean) => onChange(checked ? null : schema.type === 'string' ? '' : schema.type === 'boolean' ? false : schema.type === 'array' ? [] : schema.type === 'object' ? {} : 0)} />;
  const className = classPrefix === 'edge' ? 'edge-field' : 'component-field';
  const options = enumOptions(schema, root);
  if (schema.unsupportedUnion) return <label class="field full">{label}<textarea class={`${className} component-field-json`} data-field={name} data-kind="json" spellcheck={false} value={JSON.stringify(value, null, 2)} onInput={event => { try { onChange(JSON.parse(event.currentTarget.value || 'null')); event.currentTarget.classList.remove('bad-json'); } catch { event.currentTarget.classList.add('bad-json'); } }} /></label>;
  const itemSchema = fieldSchema(Array.isArray(schema.items) ? schema.items[0] : schema.items || {}, root);
  const itemOptions = schema.type === 'array' ? enumOptions(itemSchema, root) : [];
  if (schema.type === 'array' && itemSchema.type === 'string' && !itemOptions.length) return <TagField className={className} label={label} name={name} onChange={onChange} value={value} />;
  if (schema.type === 'array' && itemOptions.length) return <EnumListField className={className} label={label} name={name} onChange={onChange} options={itemOptions} value={value} />;
  if (schema.type === 'object' && (schema.title === 'Meter' || (schema.properties?.value && schema.properties?.minimum && schema.properties?.maximum))) return <MeterField className={className} label={label} name={name} onChange={onChange} schema={schema} value={value} />;
  if (schema.type === 'object' && schema.additionalProperties && schema.additionalProperties !== true) return <MapField className={className} label={label} name={name} onChange={onChange} schema={fieldSchema(schema.additionalProperties, root)} value={value} />;
  const tupleItem = fieldSchema(schema.items || {}, root);
  if (schema.type === 'array' && Array.isArray(tupleItem.prefixItems)) return <TupleField className={className} label={label} name={name} onChange={onChange} schemas={tupleItem.prefixItems.map((item: Json) => fieldSchema(item, root))} value={value} />;
  if (schema.type === 'object' && schema.properties) return <ObjectField className={className} label={label} name={name} onChange={onChange} root={root} schema={schema} value={value} />;
  if (options.length) return <label class="field wide">{label}<select class={className} data-field={name} data-kind={schema.type || 'string'} disabled={isNull || schema.readOnly} value={value == null ? '' : String(value)} onChange={event => onChange(options.find(option => String(option) === event.currentTarget.value) ?? event.currentTarget.value)}>{schema.nullable && <option value="" />}{options.map(option => <option value={String(option)} key={JSON.stringify(option)}>{String(option)}</option>)}</select></label>;
  if (schema.type === 'boolean') return <label class="field">{label}<input class={className} data-field={name} data-kind="boolean" type="checkbox" disabled={isNull || schema.readOnly} checked={Boolean(value)} onChange={event => onChange(event.currentTarget.checked)} /></label>;
  if (schema.type === 'integer' || schema.type === 'number') {
    const input = <input class={`${className}${schema.format === 'bunnyland-epoch' ? ' epoch-input' : ''}`} data-field={name} data-kind={schema.type} type="number" min={schema.minimum} max={schema.maximum} step={schema.multipleOf ?? (schema.type === 'integer' ? 1 : 'any')} disabled={isNull || schema.readOnly} value={value ?? ''} onInput={event => onChange(schema.type === 'integer' ? parseInt(event.currentTarget.value || '0', 10) : Number(event.currentTarget.value || 0))} />;
    if (schema.format === 'bunnyland-epoch') return <div class="field">{label}<div class="semantic-input">{input}<button type="button" data-set-current-epoch onClick={() => onChange(Number(worldEpoch || 0))}>Now</button></div><span class="epoch-preview">{Number(value ?? 0) - Number(worldEpoch || 0) >= 0 ? '+' : ''}{Number(value ?? 0) - Number(worldEpoch || 0)} seconds from world epoch {Number(worldEpoch || 0)}</span></div>;
    return <label class="field">{label}{input}</label>;
  }
  if (schema.type === 'array' || schema.type === 'object') return <label class="field full">{label}<textarea class={`${className} component-field-json`} data-field={name} data-kind={schema.type} spellcheck={false} disabled={isNull} value={JSON.stringify(value ?? (schema.type === 'array' ? [] : {}), null, 2)} onInput={event => { try { onChange(JSON.parse(event.currentTarget.value)); event.currentTarget.classList.remove('bad-json'); } catch { event.currentTarget.classList.add('bad-json'); } }} /></label>;
  const multiline = Number(schema.maxLength || 0) > 80 || ['appearance', 'biography', 'description', 'long', 'prompt', 'short', 'summary', 'text'].includes(String(name).toLowerCase());
  if (multiline) return <label class="field full">{label}<textarea class={className} data-field={name} data-kind="string" spellcheck={false} disabled={isNull || schema.readOnly} value={value ?? ''} onInput={event => onChange(event.currentTarget.value)} /></label>;
  return <label class="field wide">{label}<input class={className} data-field={name} data-kind="string" type={['uri', 'uri-reference', 'url', 'bunnyland-image-url'].includes(schema.format) ? 'url' : 'text'} list={schema.format === 'bunnyland-entity-id' ? 'entity-options' : undefined} minLength={schema.minLength} maxLength={schema.maxLength} pattern={schema.pattern} disabled={isNull || schema.readOnly} value={value ?? ''} spellcheck={false} onInput={event => onChange(event.currentTarget.value)} /></label>;
}

function TagField({ className, label, name, onChange, value }: any) {
  const ref = useRef<HTMLInputElement>(null); const tags = Array.isArray(value) ? value.map(String) : [];
  const add = () => { const tag = ref.current?.value.trim(); if (tag && !tags.includes(tag)) onChange([...tags, tag]); if (ref.current) ref.current.value = ''; };
  return <div class="field full">{label}<div class="tag-editor"><input class={`${className} component-tags-value`} data-field={name} data-kind="array" type="hidden" value={JSON.stringify(tags)} /><div class="tag-list">{tags.length ? tags.map((tag: string) => <span class="tag-pill" key={tag}><span>{tag}</span><button type="button" data-remove-tag={tag} onClick={() => onChange(tags.filter((item: string) => item !== tag))}>x</button></span>) : <span class="tiny">No items.</span>}</div><div class="tag-entry"><input class="tag-input" ref={ref} type="text" placeholder="add item..." onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} /><button type="button" data-add-tag onClick={add}>Add Item</button></div></div></div>;
}
function EnumListField({ className, label, name, onChange, options, value }: any) {
  const selected = Array.isArray(value) ? value : []; const token = (item: any) => typeof item === 'string' ? item : JSON.stringify(item);
  const available = options.filter((item: any) => !selected.some((chosen: any) => token(chosen) === token(item))); const ref = useRef<HTMLSelectElement>(null);
  return <div class="field full">{label}<div class="tag-editor enum-list-editor"><input class={`${className} component-enum-list-value`} data-field={name} data-kind="array" type="hidden" value={JSON.stringify(selected)} /><div class="tag-list enum-list">{selected.length ? selected.map((item: any) => <span class="tag-pill" key={token(item)}><span>{String(item)}</span><button type="button" data-remove-enum-option={token(item)} onClick={() => onChange(selected.filter((chosen: any) => token(chosen) !== token(item)))}>x</button></span>) : <span class="tiny">No options selected.</span>}</div><div class="tag-entry"><select class="enum-list-select" ref={ref} disabled={!available.length}>{available.map((item: any) => <option value={token(item)} key={token(item)}>{String(item)}</option>)}</select><button type="button" data-add-enum-option disabled={!available.length} onClick={() => { const item = options.find((option: any) => token(option) === ref.current?.value); if (item !== undefined) onChange([...selected, item]); }}>Add Option</button></div></div></div>;
}
function MeterField({ className, label, name, onChange, schema, value }: any) {
  const meter: Json = { value: 0, minimum: 0, maximum: 100, ...Object.fromEntries(Object.entries(schema.properties || {}).filter(([, field]: any) => Object.prototype.hasOwnProperty.call(field, 'default')).map(([key, field]: any) => [key, field.default])), ...(value || {}) };
  const write = (key: string, raw: string) => { const next = { ...meter, [key]: Number(raw || 0) }; next.value = Math.max(Number(next.minimum), Math.min(Number(next.maximum), Number(next.value))); onChange(next); };
  const keys: [string, string][] = ([['value', 'Value'], ['minimum', 'Minimum'], ['maximum', 'Maximum'], ['warning_at', 'Warning'], ['urgent_at', 'Urgent'], ['crisis_at', 'Crisis']] as [string, string][]).filter(([key]) => key in meter);
  return <div class="field full">{label}<div class="meter-editor"><input class={`${className} component-meter-value`} data-field={name} data-kind="object" type="hidden" value={JSON.stringify(meter)} /><div class="meter-controls"><div class="meter-line"><input class="meter-range" data-meter-key="value" type="range" min={meter.minimum} max={meter.maximum} step="any" value={meter.value} onInput={event => write('value', event.currentTarget.value)} /><span class="meter-readout">{Number(meter.value).toFixed(1)} / {Number(meter.maximum).toFixed(1)}</span></div><div class="meter-grid">{keys.map(([key, title]) => <label key={key}>{title}<input class="meter-input" data-meter-key={key} type="number" step="any" value={meter[key]} onInput={event => write(key, event.currentTarget.value)} /></label>)}</div></div></div></div>;
}
function MapField({ className, label, name, onChange, schema, value }: any) {
  const map = value && typeof value === 'object' && !Array.isArray(value) ? value : {}; const entries = Object.entries(map);
  const replace = (oldKey: string, key: string, nextValue: any) => { const next = { ...map }; delete next[oldKey]; if (key) next[key] = nextValue; onChange(next); };
  return <div class="field full">{label}<div class="compound-editor" data-compound-kind="map"><input class={`${className} compound-value`} data-field={name} data-kind="object" type="hidden" value={JSON.stringify(map)} /><div class="compound-rows">{entries.length ? entries.map(([key, item], index) => <div class="compound-row" data-map-row key={`${key}:${index}`}><input data-map-key type="text" value={key} placeholder="key" onInput={event => replace(key, event.currentTarget.value.trim(), item)} /><InlineInput data-map-value schema={schema} value={item} onChange={(next: any) => replace(key, key, next)} /><button type="button" data-remove-compound-row onClick={() => replace(key, '', item)}>x</button></div>) : <span class="tiny compound-empty">No entries.</span>}</div><button type="button" data-add-compound-row onClick={() => onChange({ ...map, '': defaultFor(schema, schema) })}>Add Entry</button></div></div>;
}
function ObjectField({ className, label, name, onChange, root, schema, value }: any) {
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return <div class="field full">{label}<div class="compound-editor" data-compound-kind="object"><input class={`${className} compound-value`} data-field={name} data-kind="object" type="hidden" value={JSON.stringify(object)} /><div class="compound-rows">{Object.entries(schema.properties || {}).map(([key, raw]: any) => { const field = fieldSchema(raw, root); return <label class="compound-row object-row" key={key}><span>{field.title || key}</span><InlineInput data-object-key={key} schema={field} value={Object.prototype.hasOwnProperty.call(object, key) ? object[key] : defaultFor(field, root)} onChange={(next: any) => onChange({ ...object, [key]: next })} /></label>; })}</div></div></div>;
}
function TupleField({ className, label, name, onChange, schemas, value }: any) {
  const rows = Array.isArray(value) ? value : [];
  return <div class="field full">{label}<div class="compound-editor" data-compound-kind="tuple"><input class={`${className} compound-value`} data-field={name} data-kind="array" type="hidden" value={JSON.stringify(rows)} /><div class="compound-rows">{rows.length ? rows.map((row: any[], rowIndex: number) => <div class="compound-row" data-tuple-row key={rowIndex}>{schemas.map((schema: Json, index: number) => <InlineInput data-tuple-index={index} aria-label={`Tuple item ${index + 1}`} key={index} schema={schema} value={row?.[index]} onChange={(next: any) => onChange(rows.map((current: any[], i: number) => i === rowIndex ? current.map((item, j) => j === index ? next : item) : current))} />)}<button type="button" data-remove-compound-row onClick={() => onChange(rows.filter((_: any, index: number) => index !== rowIndex))}>x</button></div>) : <span class="tiny compound-empty">No entries.</span>}</div><button type="button" data-add-compound-row onClick={() => onChange([...rows, schemas.map((schema: Json) => defaultFor(schema, schema))])}>Add Row</button></div></div>;
}

function ComponentCard({ entity, onChange, onDelete, rootSchema, type, worldEpoch }: any) {
  const fields = entity.components[type] || {}; const schema = rootSchema?.components?.[type]?.json_schema;
  const update = (name: string, value: any) => onChange(type, { ...fields, [name]: value });
  return <div class="record-card component-card" data-type={type}>
    <div class="record-head">{type} <button data-delete-component={type} onClick={() => onDelete(type)}>Delete</button></div>
    <div class="record-body">{schema?.properties ? <><div class="form-grid typed-component-fields">{Object.entries(schema.properties).map(([name, raw]: any) => <SchemaField classPrefix="component" key={name} name={name} rawSchema={raw} root={schema} value={Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : defaultFor(raw, schema)} worldEpoch={worldEpoch} onChange={(value: any) => update(name, value)} />)}</div><details class="raw-json"><summary>Raw JSON</summary><RawObject className="component-json" value={fields} onChange={(value: Json) => onChange(type, value)} /></details></> : <label class="field full">Fields<RawObject className="component-json" value={fields} onChange={(value: Json) => onChange(type, value)} /></label>}</div>
  </div>;
}
function RawObject({ className, onChange, value }: any) {
  return <textarea class={className} spellcheck={false} value={JSON.stringify(value || {}, null, 2)} onInput={event => { try { onChange(parseObject(event.currentTarget.value)); event.currentTarget.classList.remove('bad-json'); } catch { event.currentTarget.classList.add('bad-json'); } }} />;
}
function EdgeCard({ edge, index, onChange, onDelete, rootSchema, type, worldEpoch }: any) {
  const fields = edge.edge || {}; const schema = rootSchema?.edges?.[type]?.json_schema;
  const update = (name: string, value: any) => onChange(type, index, { ...edge, edge: { ...fields, [name]: value } });
  return <div class="record-card edge-card" data-type={type} data-index={index}>
    <div class="record-head">{type} → {edge.target || ''} <button data-delete-edge={`${type}:${index}`} onClick={() => onDelete(type, index)}>Delete</button></div>
    <div class="record-body"><div class="form-grid"><label class="field wide">Target<input class="edge-target" list="entity-options" type="text" value={edge.target || ''} spellcheck={false} onInput={event => onChange(type, index, { ...edge, target: event.currentTarget.value.trim() })} /></label>
      {schema?.properties ? <div class="field full"><div class="form-grid typed-edge-fields">{Object.entries(schema.properties).map(([name, raw]: any) => <SchemaField classPrefix="edge" key={name} name={name} rawSchema={raw} root={schema} value={Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : defaultFor(raw, schema)} worldEpoch={worldEpoch} onChange={(value: any) => update(name, value)} />)}</div><details class="raw-json"><summary>Raw JSON</summary><RawObject className="edge-json" value={fields} onChange={(value: Json) => onChange(type, index, { ...edge, edge: value })} /></details></div> : <label class="field full">Edge Fields<RawObject className="edge-json" value={fields} onChange={(value: Json) => onChange(type, index, { ...edge, edge: value })} /></label>}
    </div></div>
  </div>;
}

type Facade = {
  libraryFragments: Json[]; selectedId: string; world: World; worldSchema: Json | null;
  _renderAll(): void; _renderEntities(): void; _renderJson(): void; _renderLibraryControls(): void;
};
const pageWindow = window as unknown as Window & { app?: Facade };

export function WorldEditorPage() {
  const worldRef = useRef<World>(emptyWorld()); const selectedRef = useRef('entity_1');
  const schemaRef = useRef<Json | null>(null); const fragmentsRef = useRef<Json[]>([]);
  const liveBaseRef = useRef(''); const authRef = useRef<any>(null); const pendingRef = useRef(parseFocusHash());
  const timersRef = useRef<Record<string, number>>({}); const mountedRef = useRef(true);
  const [revision, setRevision] = useState(0); const [search, setSearch] = useState('');
  const [apiUrl, setApiUrl] = useState('/api/v1/'); const [status, setStatus] = useState<Status>({ kind: '', text: 'Ready' });
  const [runtime, setRuntime] = useState<{ paused: boolean | null; running: boolean }>({ paused: null, running: false });
  const [snapshotVisible, setSnapshotVisible] = useState(() => localStorage.getItem('bunnyland.editor.snapshotVisible') !== 'false');
  const revise = () => { if (mountedRef.current) setRevision(value => value + 1); }; void revision;
  const world = worldRef.current; const selected = selectedRef.current ? world.entities[selectedRef.current] : null;
  const componentNames = () => [...new Set([...(worldApi.componentNames(world, COMMON_COMPONENTS) as string[]), ...Object.keys(schemaRef.current?.components || {})])].sort();
  const edgeNames = () => [...new Set([...(worldApi.edgeNames(world, COMMON_EDGES) as string[]), ...Object.keys(schemaRef.current?.edges || {})])].sort();
  const entityName = (entity: Entity) => worldApi.entityDisplayName(entity);
  const syncUrl = (push = false) => {
    const url = new URL(location.href); if (liveBaseRef.current) url.searchParams.set('server', liveBaseRef.current); else url.searchParams.delete('server');
    url.hash = selectedRef.current ? encodeURIComponent(selectedRef.current) : '';
    history[push ? 'pushState' : 'replaceState'](null, '', url);
  };
  const selectEntity = (id: string, sync = true, push = true) => {
    if (id && worldRef.current.entities[id]) { selectedRef.current = id; pendingRef.current = ''; }
    else if (!id) selectedRef.current = '';
    if (sync) syncUrl(push); revise();
  };
  const applyPending = () => { const id = pendingRef.current; if (id && worldRef.current.entities[id]) selectEntity(id, true, false); };
  const inspectorHref = (id: string) => { const url = new URL('inspector.html', location.href); const base = liveBaseRef.current || api.normalizeBase(apiUrl); if (base) url.searchParams.set('server', base); else url.searchParams.delete('server'); url.hash = id ? `map/${encodeURIComponent(id)}` : ''; return url.toString(); };
  const exported = useMemo(() => worldApi.exportWorld(worldRef.current), [revision]);
  const jsonText = useMemo(() => JSON.stringify(exported, null, 2), [exported]);
  const problems = useMemo(() => validateWorld(exported), [exported]);
  const hasInvalid = (entity: Entity) => Object.values(entity.relationships || {}).some((edges: any) => (edges || []).some((edge: any) => edge.target && !world.entities[edge.target]));
  const parsedSearch = worldApi.parseEntitySearch(search, { invalidToken: true });
  const entities = Object.values(world.entities).sort((a, b) => entityName(a).localeCompare(entityName(b))).filter(entity => {
    const components = Object.keys(entity.components || {}); const hay = `${entityName(entity)} ${entity.id} ${worldApi.entityType(entity)} ${components.join(' ')}`.toLowerCase();
    if (parsedSearch.invalid && !hasInvalid(entity)) return false; if (parsedSearch.text && !hay.includes(parsedSearch.text)) return false;
    return parsedSearch.filters.every(({ key, value }: any) => key === 'type' ? worldApi.entityType(entity).includes(value) : key === 'id' ? entity.id.toLowerCase().includes(value) : key === 'name' ? entityName(entity).toLowerCase().includes(value) : key === 'component' || key === 'has' ? components.some(component => component.toLowerCase().includes(value)) : key === 'missing' ? !components.some(component => component.toLowerCase().includes(value)) : hay.includes(`${key}:${value}`));
  });

  const sendAdmin = async (path: string, options: Json) => {
    if (!liveBaseRef.current) throw new Error('Load a server snapshot first');
    return api.sendAdmin(liveBaseRef.current, path, { ...options, getAuth: () => authRef.current, setAuth: (auth: any) => { authRef.current = auth; } });
  };
  const mergePatch = (data: Json) => {
    for (const id of data.deleted_entities || []) delete world.entities[id];
    for (const item of data.changed_entities || []) world.entities[item.id] = worldApi.parseApiEntity(item);
    if (data.world_epoch != null) { world.metadata.epoch = data.world_epoch; world.meta ??= {}; world.meta.saved_at_epoch = data.world_epoch; }
    if (selectedRef.current && !world.entities[selectedRef.current]) selectedRef.current = Object.keys(world.entities)[0] || '';
  };
  const sendPatch = async (operations: Json[], merge = false, text = 'Patch applied') => {
    if (!liveBaseRef.current || !operations.length) return null;
    const data = await sendAdmin('/admin/world', { method: 'PATCH', body: JSON.stringify({ operations }) });
    if (merge) mergePatch(data); setStatus({ kind: 'ok', text }); return data;
  };
  const debouncePatch = (key: string, operations: Json[]) => {
    if (!liveBaseRef.current) return; window.clearTimeout(timersRef.current[key]);
    timersRef.current[key] = window.setTimeout(() => { void sendPatch(operations, false, 'Component patched').catch(error => setStatus({ kind: 'err', text: `Patch error: ${errorMessage(error)}` })); }, 350);
  };
  const fetchSnapshot = async () => {
    const base = api.normalizeBase(apiUrl); if (!base) return;
    try {
      liveBaseRef.current = base;
      worldRef.current = worldApi.parseWorld(await sendAdmin('/admin/world/snapshot', { method: 'GET', prompt: true }));
      selectedRef.current = pendingRef.current && worldRef.current.entities[pendingRef.current] ? pendingRef.current : Object.keys(worldRef.current.entities)[0] || '';
      try { const data = await sendAdmin('/admin/world/runtime', { method: 'GET', prompt: true }); setRuntime({ paused: data.paused == null ? null : Boolean(data.paused), running: Boolean(data.running) }); if (data.world_epoch != null) worldRef.current.metadata.epoch = data.world_epoch; } catch { setRuntime({ paused: null, running: false }); }
      try { schemaRef.current = await api.sendJson(base, '/play/catalog'); } catch { schemaRef.current = null; }
      try { const data = await api.sendJson(base, '/play/catalog'); const content = data.content || {}; fragmentsRef.current = normalizeFragments(content, content.library_id || 'server'); } catch { fragmentsRef.current = []; }
      applyPending(); syncUrl(); revise(); setStatus({ kind: 'ok', text: 'Server snapshot loaded · live patches enabled' });
    } catch (error) { setStatus({ kind: 'err', text: `Server error: ${errorMessage(error)}` }); }
  };

  useEffect(() => {
    mountedRef.current = true; ui.initClientMenu();
    const facade: Facade = {
      get libraryFragments() { return fragmentsRef.current; }, set libraryFragments(value) { fragmentsRef.current = value; },
      get selectedId() { return selectedRef.current; }, set selectedId(value) { selectedRef.current = value; },
      get world() { return worldRef.current; }, set world(value) { worldRef.current = value; },
      get worldSchema() { return schemaRef.current; }, set worldSchema(value) { schemaRef.current = value; },
      _renderAll: revise, _renderEntities: revise, _renderJson: revise, _renderLibraryControls: revise,
    };
    pageWindow.app = facade;
    const onLocation = () => { const id = parseFocusHash(); if (!id) selectEntity('', false); else if (worldRef.current.entities[id]) selectEntity(id, false); else { pendingRef.current = id; selectedRef.current = ''; revise(); } };
    window.addEventListener('hashchange', onLocation); window.addEventListener('popstate', onLocation);
    void (async () => { const cfg = await ui.loadConfig(); const server = api.serverFromUrl() || (typeof cfg?.serverUrl === 'string' ? cfg.serverUrl : ''); if (server) setApiUrl(server); if (api.serverFromUrl() || (cfg?.autoConnect && server)) { const base = api.normalizeBase(server); liveBaseRef.current = base; setApiUrl(server); await fetchSnapshotWith(base); } else applyPending(); })();
    async function fetchSnapshotWith(base: string) {
      try {
        worldRef.current = worldApi.parseWorld(await api.sendAdmin(base, '/admin/world/snapshot', { method: 'GET', prompt: true, getAuth: () => authRef.current, setAuth: (auth: any) => { authRef.current = auth; } }));
        liveBaseRef.current = base; selectedRef.current = pendingRef.current && worldRef.current.entities[pendingRef.current] ? pendingRef.current : Object.keys(worldRef.current.entities)[0] || '';
        try { const data = await api.sendAdmin(base, '/admin/world/runtime', { method: 'GET', prompt: true, getAuth: () => authRef.current, setAuth: (auth: any) => { authRef.current = auth; } }); setRuntime({ paused: data.paused == null ? null : Boolean(data.paused), running: Boolean(data.running) }); } catch { setRuntime({ paused: null, running: false }); }
        try { schemaRef.current = await api.sendJson(base, '/play/catalog'); } catch { schemaRef.current = null; }
        try { const data = await api.sendJson(base, '/play/catalog'); const content = data.content || {}; fragmentsRef.current = normalizeFragments(content, content.library_id || 'server'); } catch { fragmentsRef.current = []; }
        applyPending(); syncUrl(); revise(); setStatus({ kind: 'ok', text: 'Server snapshot loaded · live patches enabled' });
      } catch (error) { setStatus({ kind: 'err', text: `Server error: ${errorMessage(error)}` }); }
    }
    return () => { mountedRef.current = false; Object.values(timersRef.current).forEach(timer => window.clearTimeout(timer)); window.removeEventListener('hashchange', onLocation); window.removeEventListener('popstate', onLocation); if (pageWindow.app === facade) delete pageWindow.app; };
  }, []);

  const updateComponent = (type: string, fields: Json) => { const entity = worldRef.current.entities[selectedRef.current]; if (!entity) return; entity.components[type] = fields; revise(); debouncePatch(`component:${entity.id}:${type}`, [{ op: 'set_component', entity_id: entity.id, component: { type, fields } }]); };
  const updateEdge = (type: string, index: number, next: Json) => { const entity = worldRef.current.entities[selectedRef.current]; const previous = entity?.relationships?.[type]?.[index]; if (!entity || !previous) return; entity.relationships[type]![index] = next; revise(); if (next.target) { const operations: Json[] = previous.target && previous.target !== next.target ? [{ op: 'remove_edge', source_id: entity.id, target_id: previous.target, edge_type: type }] : []; operations.push({ op: 'set_edge', source_id: entity.id, target_id: next.target, edge: { type, fields: next.edge || {} } }); debouncePatch(`edge:${entity.id}:${type}:${index}`, operations); } };
  const defaultComponent = (type: string, entity: Entity) => { const schema = schemaRef.current?.components?.[type]?.json_schema; if (schema?.properties) return Object.fromEntries(Object.entries(schema.properties).map(([name, raw]: any) => [name, defaultFor(raw, schema)])); if (type === 'IdentityComponent') return { name: entity.id, kind: 'entity', tags: [] }; if (type === 'RoomComponent') return { title: entity.id, biome: 'unknown', indoor: false, private: false, safe: true }; if (type === 'CharacterComponent') return { species: 'bunny', biography: '', public: true }; if (type === 'WorldClockComponent') return { game_time_seconds: 0, tick_index: 0, time_scale: 1 }; return {}; };
  const defaultEdge = (type: string) => type === 'Contains' ? { mode: 'room_content', visible: true, discovered: true, order: 0 } : type === 'ExitTo' ? { direction: '', label: '', locked: false, hidden: false, action_cost: 1 } : type === 'ControlledBy' ? { generation: 0, since_epoch: Number(world.metadata.epoch || 0) } : {};

  const importFragment = async () => {
    const id = (document.getElementById('library-select') as HTMLInputElement)?.value;
    const fragment = fragmentsRef.current.find(item => item.id === id); if (!fragment) return;
    try {
      const operations = clone(fragment.operations || []);
      if (fragment.root_client_id && fragment.attach_edge) {
        if (!selected) throw new Error('select a destination entity first');
        const edge = clone(fragment.attach_edge);
        if (edge.type === 'Contains') edge.fields = { ...(edge.fields || {}), mode: selected.components?.CharacterComponent ? 'inventory' : selected.components?.ContainerComponent ? 'container' : 'room_content' };
        operations.push({ op: 'set_edge', source_id: selected.id, target_id: fragment.root_client_id, edge });
      }
      let created: string[] = [];
      if (liveBaseRef.current) {
        const data = await sendPatch(operations, true, `${fragment.title} imported`);
        created = (data?.changed_entities || []).map((entity: Entity) => entity.id).filter((entityId: string) => entityId !== selectedRef.current);
      } else created = applyLocalPatch(worldRef.current, operations);
      if (created[0]) selectedRef.current = created[0];
      revise(); syncUrl(); setStatus({ kind: 'ok', text: `${fragment.title} imported` });
    } catch (error) { setStatus({ kind: 'err', text: `Import error: ${errorMessage(error)}` }); }
  };

  return <>
    <div id="toolbar"><div class="toolbar-row" id="toolbar-row1"><span class="toolbar-brand"><img src="favicon.png" alt="" /> Bunnyland World Editor</span><span class="toolbar-sep">|</span><label for="file-input">World:</label><input type="file" id="file-input" accept=".json,application/json" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void file.text().then(text => { worldRef.current = worldApi.parseWorld(JSON.parse(text)); liveBaseRef.current = ''; selectedRef.current = pendingRef.current && worldRef.current.entities[pendingRef.current] ? pendingRef.current : Object.keys(worldRef.current.entities)[0] || ''; revise(); syncUrl(); setStatus({ kind: 'ok', text: 'World loaded' }); }).catch(error => setStatus({ kind: 'err', text: `Load error: ${errorMessage(error)}` })); }} /><button id="btn-new" onClick={() => { worldRef.current = emptyWorld(); selectedRef.current = 'entity_1'; liveBaseRef.current = ''; schemaRef.current = null; setRuntime({ paused: null, running: false }); revise(); syncUrl(); setStatus({ kind: 'ok', text: 'New world created' }); }}>New World</button><span class="toolbar-sep">|</span><label for="api-url">Server:</label><input type="text" id="api-url" value={apiUrl} spellcheck={false} onInput={event => setApiUrl(event.currentTarget.value)} /><button id="btn-fetch" onClick={() => { void fetchSnapshot(); }}>Load Snapshot</button><button id="btn-save-live" onClick={() => { void sendAdmin('/admin/world/checkpoints', { method: 'POST' }).then(data => { if (data.world_epoch != null) { world.metadata.epoch = data.world_epoch; world.meta.saved_at_epoch = data.saved_at_epoch ?? data.world_epoch; revise(); } setStatus({ kind: 'ok', text: 'World saved' }); }).catch(error => setStatus({ kind: 'err', text: `Save error: ${errorMessage(error)}` })); }}>Save Live</button><button id="btn-toggle-live" disabled={!liveBaseRef.current} title={!liveBaseRef.current ? 'Load a server snapshot before changing runtime state' : runtime.paused ? 'Resume world ticks' : 'Pause world ticks'} onClick={() => { void sendAdmin('/admin/world/runtime', { method: 'PATCH', body: JSON.stringify({ paused: !runtime.paused }) }).then(data => { setRuntime({ paused: Boolean(data.paused), running: Boolean(data.running) }); if (data.world_epoch != null) world.metadata.epoch = data.world_epoch; revise(); setStatus({ kind: 'ok', text: data.paused ? 'World paused' : 'World resumed' }); }).catch(error => setStatus({ kind: 'err', text: `Runtime error: ${errorMessage(error)}` })); }}>{!liveBaseRef.current || runtime.paused == null ? '⏯' : runtime.paused ? '▶' : '⏸'}</button><span id="runtime-status">{!liveBaseRef.current ? 'runtime: offline' : runtime.paused == null ? 'runtime: locked' : runtime.paused ? 'runtime: paused' : runtime.running ? 'runtime: playing' : 'runtime: stopped'}</span><span id="status" class={status.kind}>{status.text}</span><button id="btn-client-menu" class="client-menu-button" type="button">Menu</button></div>
      <div class="toolbar-row" id="toolbar-row2"><label for="meta-seed">Seed:</label><input type="text" id="meta-seed" value={world.meta?.seed || ''} spellcheck={false} onInput={event => { world.meta ??= {}; world.meta.seed = event.currentTarget.value; revise(); }} /><label for="meta-generator">Generator:</label><input type="text" id="meta-generator" value={world.meta?.generator || ''} spellcheck={false} onInput={event => { world.meta ??= {}; world.meta.generator = event.currentTarget.value; revise(); }} /><label for="meta-epoch">Epoch:</label><input type="number" id="meta-epoch" min="0" value={Number(world.metadata.epoch || 0)} onInput={event => { world.metadata.epoch = Number(event.currentTarget.value || 0); world.meta ??= {}; world.meta.saved_at_epoch = world.metadata.epoch; revise(); }} /><span class="toolbar-sep">|</span><button id="btn-download" onClick={() => downloadJson(jsonText, `${String(world.meta?.seed || 'world').replace(/[^a-zA-Z0-9_.-]+/g, '_') || 'world'}.json`, () => setStatus({ kind: 'ok', text: 'World JSON downloaded' }))}>Download JSON</button><button id="btn-copy" onClick={() => { void navigator.clipboard.writeText(jsonText).then(() => setStatus({ kind: 'ok', text: 'World JSON copied' })).catch(() => setStatus({ kind: 'err', text: 'Clipboard unavailable' })); }}>Copy JSON</button><button id="btn-toggle-snapshot" title={snapshotVisible ? 'Hide snapshot JSON pane' : 'Show snapshot JSON pane'} onClick={() => { const next = !snapshotVisible; setSnapshotVisible(next); localStorage.setItem('bunnyland.editor.snapshotVisible', String(next)); }}>{snapshotVisible ? 'Hide Snapshot' : 'Show Snapshot'}</button><span class="toolbar-sep">|</span><span id="world-info">{Object.keys(world.entities).length} entities · epoch {world.metadata.epoch || 0}</span></div>
      <div class="toolbar-row" id="toolbar-row3"><label for="fragment-file">Fragments:</label><input type="file" id="fragment-file" accept=".json,application/json" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void file.text().then(text => { fragmentsRef.current.push(...normalizeFragments(JSON.parse(text), file.name)); revise(); }); event.currentTarget.value = ''; }} /><span id="library-select-wrap"><SearchDropdown disabled={!fragmentsRef.current.length} dropdownId="fragment-dropdown" id="library-select" options={fragmentsRef.current.map(fragment => ({ value: fragment.id, label: `${fragment.kind} · ${fragment.title}` }))} placeholder="find fragment..." /></span><button id="btn-refresh-library" onClick={() => { if (!liveBaseRef.current) { setStatus({ kind: 'err', text: 'Load a server snapshot before refreshing the library' }); return; } void api.sendJson(liveBaseRef.current, '/play/catalog').then((data: Json) => { fragmentsRef.current = normalizeFragments(data.content || {}, data.content?.library_id || 'server'); revise(); setStatus({ kind: 'ok', text: `Loaded ${fragmentsRef.current.length} library fragments` }); }); }}>Refresh Library</button><button id="btn-import-fragment" disabled={!fragmentsRef.current.length} onClick={() => { void importFragment(); }}>Import Fragment</button><button id="btn-export-fragment" onClick={() => { if (!selected) return; downloadJson(JSON.stringify({ schema_version: 1, id: `export/${selected.id}`, title: entityName(selected), kind: worldApi.entityType(selected), root_client_id: '$root', operations: [{ op: 'add_entity', client_id: '$root', prefab: selected.prefab || 'entity', components: Object.entries(selected.components).map(([type, fields]) => ({ type, fields: clone(fields) })) }] }, null, 2), `${selected.id}.fragment.json`, () => setStatus({ kind: 'ok', text: 'Fragment JSON downloaded' })); }}>Export Selected Fragment</button></div>
    </div>
    <div id="main" class={`app-grid${snapshotVisible ? '' : ' snapshot-hidden'}`}><section class="pane"><div class="pane-header"><div class="pane-title">Entities</div><span class="pane-count" id="entity-count">{entities.length}/{Object.keys(world.entities).length}</span><button id="btn-add-entity" onClick={() => { void addEntity(worldRef.current, liveBaseRef.current, sendPatch).then(id => { selectedRef.current = id; revise(); syncUrl(); setStatus({ kind: 'ok', text: 'Entity added' }); }); }}>Add</button><button id="btn-delete-entity" disabled={!selected} onClick={() => { if (!selected || !window.confirm(`Delete ${selected.id}? Incoming edges will also be removed.`)) return; void deleteEntity(selected, worldRef.current, liveBaseRef.current, sendPatch).then(() => { selectedRef.current = Object.keys(worldRef.current.entities)[0] || ''; revise(); syncUrl(); setStatus({ kind: 'ok', text: 'Entity deleted' }); }); }}>Delete</button></div><div class="pane-body"><input type="text" id="entity-search" placeholder="find, type:, component:, invalid" spellcheck={false} autocomplete="off" value={search} onInput={event => setSearch(event.currentTarget.value)} /><div id="entity-list"><EntityList entities={entities.map(entity => ({ id: entity.id, icon: worldApi.entityIcon(entity), invalid: hasInvalid(entity), name: entityName(entity), type: worldApi.entityType(entity) }))} selectedId={selectedRef.current} onSelect={id => selectEntity(id)} /></div></div></section>
      <section class="pane"><div class="pane-header"><div class="pane-title">Entity Editor</div><span class="pane-count" id="selected-label">{selected?.id || 'No selection'}</span>{selected && <a class="nav-link push" id="inspector-link" href={inspectorHref(selected.id)}>Open World Graph</a>}</div><div class="editor-scroll" id="entity-editor">{selected ? <EntityEditor entity={selected} componentNames={componentNames()} edgeNames={edgeNames()} schema={schemaRef.current} world={world} onRevise={revise} onStatus={setStatus} onComponent={updateComponent} onEdge={updateEdge} onSelect={(id: string) => { selectedRef.current = id; revise(); syncUrl(); }} sendPatch={sendPatch} defaultComponent={defaultComponent} defaultEdge={defaultEdge} live={Boolean(liveBaseRef.current)} /> : <div class="empty">Select or add an entity.</div>}</div></section>
      <section class="pane" id="preview-pane"><div class="pane-header"><div class="pane-title">Snapshot JSON</div><span class="pane-count" id="json-size">{new Blob([jsonText]).size} bytes</span></div><textarea id="json-output" spellcheck={false} readOnly value={jsonText} /><div id="problems" class={problems.length ? '' : 'ok'}>{problems.length ? problems.map((problem, index) => <span key={`${problem.message}:${index}`}>{problem.entityId && world.entities[problem.entityId] ? <><button type="button" class="problem-link" data-editor-entity={problem.entityId} onClick={() => selectEntity(problem.entityId!)}>{problem.entityId}</button> {problem.message}</> : problem.message}{index < problems.length - 1 && <br />}</span>) : 'Valid world JSON.'}</div></section>
    </div>
    <datalist id="component-options">{componentNames().map(name => <option value={name} key={name} />)}</datalist><datalist id="edge-options">{edgeNames().map(name => <option value={name} key={name} />)}</datalist><datalist id="entity-options">{Object.values(world.entities).sort((a, b) => a.id.localeCompare(b.id)).map(entity => <option value={entity.id} key={entity.id}>{entityName(entity)}</option>)}</datalist>
  </>;
}

function EntityEditor({ componentNames, defaultComponent, defaultEdge, edgeNames, entity, live, onComponent, onEdge, onRevise, onSelect, onStatus, schema, sendPatch, world }: any) {
  const idRef = useRef<HTMLInputElement>(null); const prefabRef = useRef<HTMLInputElement>(null); const createdRef = useRef<HTMLInputElement>(null);
  const applyFields = () => {
    const nextId = idRef.current?.value.trim() || '';
    if (!nextId) { onStatus({ kind: 'err', text: 'Entity ID is required' }); return; }
    if (nextId !== entity.id && world.entities[nextId]) { onStatus({ kind: 'err', text: 'Entity ID already exists' }); return; }
    if (live && nextId !== entity.id) { onStatus({ kind: 'err', text: 'Live ECS entity IDs cannot be renamed' }); return; }
    entity.prefab = prefabRef.current?.value.trim() || 'entity'; entity.created_epoch = Number(createdRef.current?.value || 0);
    if (nextId !== entity.id) {
      const oldId = entity.id; delete world.entities[oldId]; entity.id = nextId; world.entities[nextId] = entity;
      for (const other of Object.values(world.entities) as Entity[]) for (const edges of Object.values(other.relationships || {}) as any[][]) for (const edge of edges || []) if (edge.target === oldId) edge.target = nextId;
      onSelect(nextId);
    } else onRevise();
    onStatus({ kind: 'ok', text: 'Entity updated' });
  };
  const addComponent = async () => {
    const type = (document.getElementById('add-component-type') as HTMLInputElement)?.value; if (!type || entity.components[type]) return;
    const fields = defaultComponent(type, entity);
    if (live) { try { await sendPatch([{ op: 'add_component', entity_id: entity.id, component: { type, fields } }], true, 'Component added'); } catch (error) { onStatus({ kind: 'err', text: `Patch error: ${errorMessage(error)}` }); return; } }
    else entity.components[type] = fields;
    onRevise(); clearDropdown('add-component-dropdown'); onStatus({ kind: 'ok', text: 'Component added' });
  };
  const deleteComponent = async (type: string) => {
    if (live) { try { await sendPatch([{ op: 'remove_component', entity_id: entity.id, component_type: type }], true, 'Component deleted'); } catch (error) { onStatus({ kind: 'err', text: `Patch error: ${errorMessage(error)}` }); return; } }
    delete entity.components[type]; onRevise(); onStatus({ kind: 'ok', text: 'Component deleted' });
  };
  const addEdge = async () => {
    const type = (document.getElementById('add-edge-type') as HTMLInputElement)?.value; const target = (document.getElementById('add-edge-target') as HTMLInputElement)?.value;
    if (!type) { onStatus({ kind: 'err', text: 'Choose an edge type' }); return; } if (!target) { onStatus({ kind: 'err', text: 'Choose a target entity' }); return; }
    const edge = defaultEdge(type);
    if (live) { try { await sendPatch([{ op: 'set_edge', source_id: entity.id, target_id: target, edge: { type, fields: edge } }], true, 'Edge added'); } catch (error) { onStatus({ kind: 'err', text: `Patch error: ${errorMessage(error)}` }); return; } }
    else { entity.relationships[type] ??= []; entity.relationships[type].push({ target, edge }); }
    onRevise(); clearDropdown('add-edge-type-dropdown'); clearDropdown('add-edge-target-dropdown'); onStatus({ kind: 'ok', text: 'Edge added' });
  };
  const deleteEdge = async (type: string, index: number) => {
    const target = entity.relationships[type]?.[index]?.target;
    if (live && target) { try { await sendPatch([{ op: 'remove_edge', source_id: entity.id, target_id: target, edge_type: type }], true, 'Edge deleted'); } catch (error) { onStatus({ kind: 'err', text: `Patch error: ${errorMessage(error)}` }); return; } }
    entity.relationships[type]?.splice(index, 1); if (!entity.relationships[type]?.length) delete entity.relationships[type]; onRevise(); onStatus({ kind: 'ok', text: 'Edge deleted' });
  };
  const componentOptions = componentNames.filter((name: string) => !entity.components[name]);
  const targets = (Object.values(world.entities) as Entity[]).filter(target => target.id !== entity.id).sort((a, b) => worldApi.entityDisplayName(a).localeCompare(worldApi.entityDisplayName(b)));
  const edgeRows = Object.entries(entity.relationships || {}).sort(([a], [b]) => a.localeCompare(b)).flatMap(([type, edges]: any) => (edges || []).map((edge: Json, index: number) => ({ edge, index, type })));
  return <>
    <div class="section"><div class="section-title">Entity</div><div class="form-grid"><label class="field wide">Entity ID<input id="entity-id" ref={idRef} type="text" defaultValue={entity.id} spellcheck={false} /></label><label class="field">Prefab<input id="entity-prefab" ref={prefabRef} type="text" defaultValue={entity.prefab || 'entity'} spellcheck={false} /></label><label class="field">Created Epoch<input id="entity-created" ref={createdRef} type="number" min="0" defaultValue={Number(entity.created_epoch || 0)} /></label></div><div class="button-row"><button id="btn-rename-entity" onClick={applyFields}>Apply Entity Fields</button></div></div>
    <div class="section"><div class="section-title">Components <SearchDropdown disabled={!componentOptions.length} dropdownId="add-component-dropdown" id="add-component-type" options={componentOptions.map((name: string) => ({ value: name, label: name }))} placeholder="find component..." /><button id="btn-add-component" disabled={!componentOptions.length} onClick={() => { void addComponent(); }}>Add Component</button></div><div id="component-list">{Object.entries(entity.components || {}).length ? Object.keys(entity.components).sort().map(type => <ComponentCard entity={entity} key={type} onChange={onComponent} onDelete={(value: string) => { void deleteComponent(value); }} rootSchema={schema} type={type} worldEpoch={world.metadata.epoch} />) : <div class="empty">No components.</div>}</div></div>
    <Generation entity={entity} live={live} onStatus={onStatus} sendPatch={sendPatch} />
    <div class="section"><div class="section-title">Outgoing Edges <SearchDropdown disabled={!targets.length} dropdownId="add-edge-type-dropdown" id="add-edge-type" options={edgeNames.map((name: string) => ({ value: name, label: name }))} placeholder="edge type..." /><SearchDropdown disabled={!targets.length} dropdownId="add-edge-target-dropdown" id="add-edge-target" options={targets.map(target => ({ value: target.id, label: `${worldApi.entityDisplayName(target)} · ${target.id}` }))} placeholder="target entity..." /><button id="btn-add-edge" disabled={!targets.length} onClick={() => { void addEdge(); }}>Add Edge</button></div><div id="edge-list">{edgeRows.length ? edgeRows.map(({ edge, index, type }: any) => <EdgeCard edge={edge} index={index} key={`${type}:${index}:${edge.target}`} onChange={onEdge} onDelete={(value: string, item: number) => { void deleteEdge(value, item); }} rootSchema={schema} type={type} worldEpoch={world.metadata.epoch} />) : <div class="empty">No outgoing edges.</div>}</div></div>
  </>;
}

function Generation({ entity, live, onStatus }: any) {
  const sections = [];
  if (entity.components?.DoorComponent) sections.push(<div class="record-card" key="room"><div class="record-head">Generate Room</div><div class="record-body"><div class="form-grid"><label class="field">Direction<input id="gen-room-direction" type="text" disabled={!live} /></label><label class="field full">Prompt / Theme<textarea id="gen-room-prompt" disabled={!live} /></label></div><div class="button-row"><button id="btn-gen-room" disabled={!live} onClick={() => onStatus({ kind: 'err', text: 'Room generation requires live operator access' })}>Generate and Apply Room</button></div></div></div>);
  if (entity.components?.RoomComponent) sections.push(<div class="record-card" key="character"><div class="record-head">Generate Character</div><div class="record-body"><label class="field full">Prompt / Theme<textarea id="gen-character-prompt" disabled={!live} /></label><div class="button-row"><button id="btn-gen-character" disabled={!live}>Generate and Apply Character</button></div></div></div>);
  if (entity.components?.RoomComponent || entity.components?.CharacterComponent || entity.components?.ContainerComponent) sections.push(<div class="record-card" key="item"><div class="record-head">Generate Item</div><div class="record-body"><label class="field full">Prompt / Theme<textarea id="gen-item-prompt" disabled={!live} /></label><div class="button-row"><button id="btn-gen-item" disabled={!live}>Generate and Apply Item</button></div></div></div>);
  return sections.length ? <div class="section"><div class="section-title">DM Generation</div>{sections}{!live && <div class="tiny">Load a server snapshot to generate live patches.</div>}</div> : null;
}

function normalizeFragments(data: Json, source: string) {
  const raw = Array.isArray(data?.fragments) ? data.fragments : [data];
  return raw.filter((fragment: Json) => fragment && Array.isArray(fragment.operations)).map((fragment: Json, index: number) => ({ ...fragment, schema_version: fragment.schema_version || 1, id: fragment.id || `${source}/fragment-${index + 1}`, title: fragment.title || fragment.id || `Fragment ${index + 1}`, kind: fragment.kind || 'fragment', operations: clone(fragment.operations), source }));
}
function clearDropdown(id: string) {
  const root = document.getElementById(id);
  const input = root?.querySelector<HTMLInputElement>('.search-dropdown-input');
  const value = root?.querySelector<HTMLInputElement>('.search-dropdown-value');
  if (input) input.value = '';
  if (value) value.value = '';
}
function applyLocalPatch(world: World, operations: Json[]) {
  const aliases: Record<string, string> = {}; const created: string[] = [];
  const resolve = (id: string) => aliases[id] || (world.entities[id] ? id : (() => { throw new Error(`entity ${id} does not exist`); })());
  for (const operation of operations) {
    if (operation.op === 'add_entity') {
      let index = Object.keys(world.entities).length + 1; while (world.entities[`entity_${index}`]) index += 1; const id = `entity_${index}`;
      if (operation.client_id) aliases[operation.client_id] = id; created.push(id);
      world.entities[id] = { id, prefab: operation.prefab || 'entity', created_epoch: Number(world.metadata.epoch || 0), components: Object.fromEntries((operation.components || []).map((component: Json) => [component.type, clone(component.fields || {})])), relationships: {} };
    } else if (operation.op === 'set_edge') {
      const source = resolve(operation.source_id); const target = resolve(operation.target_id); const type = operation.edge?.type; if (!type) throw new Error('edge type is required');
      world.entities[source]!.relationships[type] ??= []; world.entities[source]!.relationships[type]!.push({ target, edge: clone(operation.edge.fields || {}) });
    } else if (operation.op === 'add_component' || operation.op === 'set_component') world.entities[resolve(operation.entity_id)]!.components[operation.component.type] = clone(operation.component.fields || {});
    else throw new Error(`unsupported offline fragment operation ${operation.op}`);
  }
  return created;
}

function validateWorld(snapshot: Json) {
  const problems: { entityId?: string; message: string }[] = []; const ids = new Set(Object.keys(snapshot.entities || {}));
  const clocks = Object.entries(snapshot.components?.WorldClockComponent || {}); if (clocks.length !== 1) problems.push({ message: `expected exactly one WorldClockComponent, found ${clocks.length}` });
  for (const [type, table] of Object.entries(snapshot.relationships || {}) as any) for (const [source, edges] of Object.entries(table || {}) as any) { if (!ids.has(source)) problems.push({ message: `${type}: source ${source} does not exist` }); for (const edge of edges || []) if (!ids.has(edge.target)) problems.push({ entityId: source, message: `${type}: ${source} targets missing entity ${edge.target}` }); }
  return problems;
}
function downloadJson(text: string, filename: string, done: () => void) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); URL.revokeObjectURL(url); anchor.remove(); done();
}
async function addEntity(world: World, live: string, sendPatch: any) {
  if (live) { const data = await sendPatch([{ op: 'add_entity', components: [{ type: 'IdentityComponent', fields: { name: 'entity', kind: 'entity', tags: [] } }] }], true, 'Entity added'); return data?.changed_entities?.[0]?.id || Object.keys(world.entities)[0] || ''; }
  let index = Object.keys(world.entities).length + 1; while (world.entities[`entity_${index}`]) index += 1; const id = `entity_${index}`; world.entities[id] = { id, prefab: 'entity', created_epoch: Number(world.metadata.epoch || 0), components: { IdentityComponent: { name: id, kind: 'entity', tags: [] } }, relationships: {} }; return id;
}
async function deleteEntity(entity: Entity, world: World, live: string, sendPatch: any) {
  if (live) await sendPatch([{ op: 'delete_entity', entity_id: entity.id }], true, 'Entity deleted'); else delete world.entities[entity.id];
  for (const other of Object.values(world.entities)) for (const [type, edges] of Object.entries(other.relationships || {})) { other.relationships[type] = (edges || []).filter((edge: any) => edge.target !== entity.id); if (!other.relationships[type].length) delete other.relationships[type]; }
}

const root = document.getElementById('app');
if (root) render(<WorldEditorPage />, root);
