import { Button, TagEditor } from '@bunnyland/ui-web/preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

import {
  cloneJson,
  jsonObject,
  type EditorFieldSchema,
  type JsonObject,
  type JsonSchema,
  type JsonValue,
} from './models';

function resolveRef(schema: JsonSchema, root: JsonSchema): JsonSchema {
  const prefix = '#/$defs/';
  if (!schema.$ref?.startsWith(prefix)) return schema;
  const target = root.$defs?.[schema.$ref.slice(prefix.length)];
  if (!target) return schema;
  const siblings = { ...schema };
  delete siblings.$ref;
  return { ...target, ...siblings };
}

function variants(schema: JsonSchema): JsonSchema[] | null {
  return schema.anyOf || schema.oneOf || null;
}

export function fieldSchema(schema: JsonSchema, root: JsonSchema): EditorFieldSchema {
  const resolved = resolveRef(schema, root);
  const choices = variants(resolved);
  const concrete = choices?.filter(item => resolveRef(item, root).type !== 'null') || [];
  const field: EditorFieldSchema = { ...resolveRef(choices && concrete.length === 1 ? concrete[0] || resolved : resolved, root) };
  for (const key of ['default', 'title', 'description'] as const) {
    if (resolved[key] !== undefined) Object.assign(field, { [key]: resolved[key] });
    if (schema[key] !== undefined) Object.assign(field, { [key]: schema[key] });
  }
  if (choices) {
    field.nullable = choices.some(item => resolveRef(item, root).type === 'null');
    field.unsupportedUnion = concrete.length !== 1;
  }
  return field;
}

export function enumOptions(schema: JsonSchema, root: JsonSchema): JsonValue[] {
  const resolved = resolveRef(schema, root);
  if (resolved.enum) return resolved.enum;
  if (resolved.const !== undefined) return [resolved.const];
  const choices = variants(resolved);
  if (!choices) return [];
  return choices.flatMap(item => item.type === 'null' ? [] : enumOptions(item, root))
    .filter((item, index, all) => all.findIndex(value => JSON.stringify(value) === JSON.stringify(item)) === index);
}

export function defaultFor(schema: JsonSchema, root: JsonSchema): JsonValue {
  const field = fieldSchema(schema, root);
  if (field.default !== undefined) return cloneJson(field.default);
  if (field.unsupportedUnion) return null;
  const options = enumOptions(field, root);
  if (options[0] !== undefined) return cloneJson(options[0]);
  if (field.type === 'boolean') return false;
  if (field.type === 'integer' || field.type === 'number') return 0;
  if (field.type === 'array') return [];
  if (field.type === 'object') return {};
  return '';
}

function inputValue(value: JsonValue | undefined): string | number {
  return typeof value === 'number' || typeof value === 'string' ? value : '';
}

function typedValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, schema: EditorFieldSchema): JsonValue {
  if (schema.type === 'boolean') return (input as HTMLInputElement).checked;
  if (schema.type === 'integer') return input.value === '' ? 0 : parseInt(input.value, 10);
  if (schema.type === 'number') return input.value === '' ? 0 : Number(input.value);
  if (schema.type === 'array' || schema.type === 'object' || schema.unsupportedUnion) {
    const fallback = schema.type === 'array' ? '[]' : schema.type === 'object' ? '{}' : 'null';
    const value: unknown = JSON.parse(input.value || fallback);
    if (schema.type === 'object') return jsonObject(value);
    if (schema.type === 'array' && !Array.isArray(value)) throw new Error('expected array');
    if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' || Array.isArray(value)) return value;
    return jsonObject(value);
  }
  return input.value;
}

interface InlineInputProps {
  'aria-label'?: string;
  'data-map-value'?: boolean;
  'data-object-key'?: string;
  'data-tuple-index'?: number;
  onChange: (value: JsonValue) => void;
  schema: EditorFieldSchema;
  value?: JsonValue;
}

function InlineInput({ schema, value, onChange, ...data }: InlineInputProps) {
  const commit = (event: Event): void => {
    const input = event.currentTarget as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    try {
      onChange(typedValue(input, schema));
      input.classList.remove('bad-json');
    } catch {
      input.classList.add('bad-json');
    }
  };
  if (schema.type === 'boolean') return <input {...data} data-inline-kind="boolean" type="checkbox" checked={Boolean(value)} onChange={commit} />;
  if (schema.type === 'integer' || schema.type === 'number') return <input {...data} data-inline-kind={schema.type} type="number" min={schema.minimum} max={schema.maximum} step={schema.multipleOf ?? (schema.type === 'integer' ? 1 : 'any')} value={inputValue(value)} onInput={commit} />;
  if (schema.type === 'array' || schema.type === 'object') return <textarea {...data} data-inline-kind={schema.type} spellcheck={false} value={JSON.stringify(value ?? (schema.type === 'array' ? [] : {}))} onInput={commit} />;
  return <input {...data} data-inline-kind="string" type="text" list={schema.format === 'bunnyland-entity-id' ? 'entity-options' : undefined} value={inputValue(value)} spellcheck={false} onInput={commit} />;
}

interface FieldLabelProps {
  description: string | undefined;
  name: string;
  nullable: boolean | undefined;
  nullValue: boolean;
  onNull: (checked: boolean) => void;
  title: string;
}

function FieldLabel({ name, nullable, nullValue, description, title, onNull }: FieldLabelProps) {
  if (!nullable) return <>{title}{description && <span class="field-description" title={description}>{description}</span>}</>;
  return <span class="field-label">
    <span>{title}{description && <span class="field-description" title={description}>{description}</span>}</span>
    <span class="nullable-choice"><input class="nullable-toggle" data-field={name} type="checkbox" checked={nullValue} onChange={event => onNull(event.currentTarget.checked)} /> null</span>
  </span>;
}

interface SchemaFieldProps {
  classPrefix: 'component' | 'edge';
  name: string;
  onChange: (value: JsonValue) => void;
  rawSchema: JsonSchema;
  root: JsonSchema;
  value: JsonValue | undefined;
  worldEpoch: number;
}

export function SchemaField({ classPrefix, name, onChange, rawSchema, root, value, worldEpoch }: SchemaFieldProps) {
  const schema = fieldSchema(rawSchema, root);
  const title = schema.title || name;
  const isNull = Boolean(schema.nullable && value == null);
  const schemaWithoutDefault = { ...schema };
  delete schemaWithoutDefault.default;
  const label = <FieldLabel name={name} nullable={schema.nullable} nullValue={isNull} description={schema.description} title={title} onNull={checked => onChange(checked ? null : defaultFor(schemaWithoutDefault, root))} />;
  const className = classPrefix === 'edge' ? 'edge-field' : 'component-field';
  const options = enumOptions(schema, root);
  if (schema.unsupportedUnion) return <label class="field full">{label}<JsonTextarea className={`${className} component-field-json`} kind="json" name={name} value={value ?? null} onChange={onChange} /></label>;
  const rawItems = Array.isArray(schema.items) ? schema.items[0] : schema.items;
  const itemSchema = fieldSchema(rawItems || {}, root);
  const itemOptions = schema.type === 'array' ? enumOptions(itemSchema, root) : [];
  if (schema.type === 'array' && itemSchema.type === 'string' && !itemOptions.length) return <TagField className={className} label={label} name={name} onChange={onChange} value={value} />;
  if (schema.type === 'array' && itemOptions.length) return <EnumListField className={className} label={label} name={name} onChange={onChange} options={itemOptions} value={value} />;
  if (schema.type === 'object' && (schema.title === 'Meter' || (schema.properties?.value && schema.properties.minimum && schema.properties.maximum))) return <MeterField className={className} label={label} name={name} onChange={onChange} schema={schema} value={value} />;
  if (schema.type === 'object' && schema.additionalProperties && schema.additionalProperties !== true) return <MapField className={className} label={label} name={name} onChange={onChange} schema={fieldSchema(schema.additionalProperties, root)} value={value} />;
  const tupleSchemas = schema.prefixItems || fieldSchema(rawItems || {}, root).prefixItems;
  if (schema.type === 'array' && tupleSchemas) return <TupleField className={className} label={label} name={name} onChange={onChange} schemas={tupleSchemas.map(item => fieldSchema(item, root))} value={value} />;
  if (schema.type === 'object' && schema.properties) return <ObjectField className={className} label={label} name={name} onChange={onChange} root={root} schema={schema} value={value} />;
  if (options.length) return <label class="field wide">{label}<select class={className} data-field={name} data-kind={schema.type || 'string'} disabled={isNull || schema.readOnly} value={value == null ? '' : String(value)} onChange={event => onChange(options.find(option => String(option) === event.currentTarget.value) ?? event.currentTarget.value)}>{schema.nullable && <option value="" />}{options.map(option => <option value={String(option)} key={JSON.stringify(option)}>{String(option)}</option>)}</select></label>;
  if (schema.type === 'boolean') return <label class="field">{label}<input class={className} data-field={name} data-kind="boolean" type="checkbox" disabled={isNull || schema.readOnly} checked={Boolean(value)} onChange={event => onChange(event.currentTarget.checked)} /></label>;
  if (schema.type === 'integer' || schema.type === 'number') {
    const numeric = typeof value === 'number' ? value : '';
    const input = <input class={`${className}${schema.format === 'bunnyland-epoch' ? ' epoch-input' : ''}`} data-field={name} data-kind={schema.type} type="number" min={schema.minimum} max={schema.maximum} step={schema.multipleOf ?? (schema.type === 'integer' ? 1 : 'any')} disabled={isNull || schema.readOnly} value={numeric} onInput={event => onChange(schema.type === 'integer' ? parseInt(event.currentTarget.value || '0', 10) : Number(event.currentTarget.value || 0))} />;
    if (schema.format === 'bunnyland-epoch') {
      const delta = Number(value ?? 0) - worldEpoch;
      return <div class="field">{label}<div class="semantic-input">{input}<Button data-set-current-epoch onClick={() => onChange(worldEpoch)}>Now</Button></div><span class="epoch-preview">{delta >= 0 ? '+' : ''}{delta} seconds from world epoch {worldEpoch}</span></div>;
    }
    return <label class="field">{label}{input}</label>;
  }
  if (schema.type === 'array' || schema.type === 'object') return <label class="field full">{label}<JsonTextarea className={`${className} component-field-json`} disabled={isNull} kind={schema.type} name={name} value={value ?? (schema.type === 'array' ? [] : {})} onChange={onChange} /></label>;
  const multiline = Number(schema.maxLength || 0) > 80 || ['appearance', 'biography', 'description', 'long', 'prompt', 'short', 'summary', 'text'].includes(name.toLowerCase());
  if (multiline) return <label class="field full">{label}<textarea class={className} data-field={name} data-kind="string" spellcheck={false} disabled={isNull || schema.readOnly} value={inputValue(value)} onInput={event => onChange(event.currentTarget.value)} /></label>;
  return <label class="field wide">{label}<input class={className} data-field={name} data-kind="string" type={['uri', 'uri-reference', 'url', 'bunnyland-image-url'].includes(schema.format || '') ? 'url' : 'text'} list={schema.format === 'bunnyland-entity-id' ? 'entity-options' : undefined} minLength={schema.minLength} maxLength={schema.maxLength} pattern={schema.pattern} disabled={isNull || schema.readOnly} value={inputValue(value)} spellcheck={false} onInput={event => onChange(event.currentTarget.value)} /></label>;
}

function JsonTextarea({ className, disabled, kind, name, onChange, value }: { className: string; disabled?: boolean; kind: string; name: string; onChange: (value: JsonValue) => void; value: JsonValue }) {
  return <textarea class={className} data-field={name} data-kind={kind} spellcheck={false} disabled={disabled} value={JSON.stringify(value, null, 2)} onInput={event => {
    try {
      const parsed: unknown = JSON.parse(event.currentTarget.value || 'null');
      if (kind === 'object' || kind === 'json' && parsed !== null && !Array.isArray(parsed) && typeof parsed === 'object') onChange(jsonObject(parsed));
      else if (parsed === null || typeof parsed === 'boolean' || typeof parsed === 'number' || typeof parsed === 'string' || Array.isArray(parsed)) onChange(parsed);
      else onChange(jsonObject(parsed));
      event.currentTarget.classList.remove('bad-json');
    } catch { event.currentTarget.classList.add('bad-json'); }
  }} />;
}

function TagField({ className, label, name, onChange, value }: { className: string; label: ComponentChildren; name: string; onChange: (value: JsonValue) => void; value: JsonValue | undefined }) {
  const root = useRef<HTMLDivElement>(null);
  const tags = Array.isArray(value) ? value.map(String) : [];
  const tagsKey = tags.join('\0');
  useEffect(() => {
    const input = root.current?.querySelector('input');
    const buttons = root.current?.querySelectorAll('button');
    input?.classList.add('tag-input');
    buttons?.forEach(button => {
      if (button.getAttribute('aria-label')?.startsWith('Remove tag ')) button.dataset.removeTag = button.getAttribute('aria-label')?.slice(11) || '';
      else button.dataset.addTag = '';
    });
  }, [tagsKey]);
  return <div class="field full">{label}<input class={`${className} component-tags-value`} data-field={name} data-kind="array" type="hidden" value={JSON.stringify(tags)} /><div ref={root}><TagEditor addLabel="Add Item" emptyLabel="No items." placeholder="add item..." value={tags} onChange={onChange} /></div></div>;
}

function token(item: JsonValue): string { return typeof item === 'string' ? item : JSON.stringify(item); }

function EnumListField({ className, label, name, onChange, options, value }: { className: string; label: ComponentChildren; name: string; onChange: (value: JsonValue) => void; options: JsonValue[]; value: JsonValue | undefined }) {
  const selected = Array.isArray(value) ? value : [];
  const available = options.filter(item => !selected.some(chosen => token(chosen) === token(item)));
  const ref = useRef<HTMLSelectElement>(null);
  return <div class="field full">{label}<div class="tag-editor enum-list-editor"><input class={`${className} component-enum-list-value`} data-field={name} data-kind="array" type="hidden" value={JSON.stringify(selected)} /><div class="tag-list enum-list">{selected.length ? selected.map(item => <span class="tag-pill" key={token(item)}><span>{String(item)}</span><Button data-remove-enum-option={token(item)} onClick={() => onChange(selected.filter(chosen => token(chosen) !== token(item)))}>x</Button></span>) : <span class="tiny">No options selected.</span>}</div><div class="tag-entry"><select class="enum-list-select" ref={ref} disabled={!available.length}>{available.map(item => <option value={token(item)} key={token(item)}>{String(item)}</option>)}</select><Button data-add-enum-option disabled={!available.length} onClick={() => { const item = options.find(option => token(option) === ref.current?.value); if (item !== undefined) onChange([...selected, item]); }}>Add Option</Button></div></div></div>;
}

function objectValue(value: JsonValue | undefined): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function MeterField({ className, label, name, onChange, schema, value }: { className: string; label: ComponentChildren; name: string; onChange: (value: JsonValue) => void; schema: EditorFieldSchema; value: JsonValue | undefined }) {
  const defaults = Object.fromEntries(Object.entries(schema.properties || {}).flatMap(([key, field]) => field.default === undefined ? [] : [[key, field.default]]));
  const meter: JsonObject = { value: 0, minimum: 0, maximum: 100, ...defaults, ...objectValue(value) };
  const write = (key: string, raw: string): void => {
    const next: JsonObject = { ...meter, [key]: Number(raw || 0) };
    next.value = Math.max(Number(next.minimum), Math.min(Number(next.maximum), Number(next.value)));
    onChange(next);
  };
  const labels: Array<[string, string]> = [['value', 'Value'], ['minimum', 'Minimum'], ['maximum', 'Maximum'], ['warning_at', 'Warning'], ['urgent_at', 'Urgent'], ['crisis_at', 'Crisis']];
  const keys = labels.filter(([key]) => key in meter);
  return <div class="field full">{label}<div class="meter-editor"><input class={`${className} component-meter-value`} data-field={name} data-kind="object" type="hidden" value={JSON.stringify(meter)} /><div class="meter-controls"><div class="meter-line"><input class="meter-range" data-meter-key="value" type="range" min={Number(meter.minimum)} max={Number(meter.maximum)} step="any" value={Number(meter.value)} onInput={event => write('value', event.currentTarget.value)} /><span class="meter-readout">{Number(meter.value).toFixed(1)} / {Number(meter.maximum).toFixed(1)}</span></div><div class="meter-grid">{keys.map(([key, title]) => <label key={key}>{title}<input class="meter-input" data-meter-key={key} type="number" step="any" value={Number(meter[key])} onInput={event => write(key, event.currentTarget.value)} /></label>)}</div></div></div></div>;
}

function MapField({ className, label, name, onChange, schema, value }: { className: string; label: ComponentChildren; name: string; onChange: (value: JsonValue) => void; schema: EditorFieldSchema; value: JsonValue | undefined }) {
  const map = objectValue(value);
  const replace = (oldKey: string, key: string, nextValue: JsonValue): void => {
    const next = { ...map };
    delete next[oldKey];
    if (key) next[key] = nextValue;
    onChange(next);
  };
  return <div class="field full">{label}<div class="compound-editor" data-compound-kind="map"><input class={`${className} compound-value`} data-field={name} data-kind="object" type="hidden" value={JSON.stringify(map)} /><div class="compound-rows">{Object.entries(map).length ? Object.entries(map).map(([key, item], index) => <div class="compound-row" data-map-row key={`${key}:${index}`}><input data-map-key type="text" value={key} placeholder="key" onInput={event => replace(key, event.currentTarget.value.trim(), item)} /><InlineInput data-map-value schema={schema} value={item} onChange={next => replace(key, key, next)} /><Button data-remove-compound-row onClick={() => replace(key, '', item)}>x</Button></div>) : <span class="tiny compound-empty">No entries.</span>}</div><Button data-add-compound-row onClick={() => onChange({ ...map, '': defaultFor(schema, schema) })}>Add Entry</Button></div></div>;
}

function ObjectField({ className, label, name, onChange, root, schema, value }: { className: string; label: ComponentChildren; name: string; onChange: (value: JsonValue) => void; root: JsonSchema; schema: EditorFieldSchema; value: JsonValue | undefined }) {
  const object = objectValue(value);
  return <div class="field full">{label}<div class="compound-editor" data-compound-kind="object"><input class={`${className} compound-value`} data-field={name} data-kind="object" type="hidden" value={JSON.stringify(object)} /><div class="compound-rows">{Object.entries(schema.properties || {}).map(([key, raw]) => { const field = fieldSchema(raw, root); return <label class="compound-row object-row" key={key}><span>{field.title || key}</span><InlineInput data-object-key={key} schema={field} value={object[key] ?? defaultFor(field, root)} onChange={next => onChange({ ...object, [key]: next })} /></label>; })}</div></div></div>;
}

function TupleField({ className, label, name, onChange, schemas, value }: { className: string; label: ComponentChildren; name: string; onChange: (value: JsonValue) => void; schemas: EditorFieldSchema[]; value: JsonValue | undefined }) {
  const rows = Array.isArray(value) ? value.filter(Array.isArray) : [];
  return <div class="field full">{label}<div class="compound-editor" data-compound-kind="tuple"><input class={`${className} compound-value`} data-field={name} data-kind="array" type="hidden" value={JSON.stringify(rows)} /><div class="compound-rows">{rows.length ? rows.map((row, rowIndex) => <div class="compound-row" data-tuple-row key={rowIndex}>{schemas.map((schema, index) => <InlineInput data-tuple-index={index} aria-label={`Tuple item ${index + 1}`} key={index} schema={schema} value={row[index]} onChange={next => onChange(rows.map((current, currentIndex) => currentIndex === rowIndex ? current.map((item, itemIndex) => itemIndex === index ? next : item) : current))} />)}<Button data-remove-compound-row onClick={() => onChange(rows.filter((_row, index) => index !== rowIndex))}>x</Button></div>) : <span class="tiny compound-empty">No entries.</span>}</div><Button data-add-compound-row onClick={() => onChange([...rows, schemas.map(schema => defaultFor(schema, schema))])}>Add Row</Button></div></div>;
}

export function RawObject({ className, onChange, value }: { className: string; onChange: (value: JsonObject) => void; value: JsonObject }) {
  return <textarea class={className} spellcheck={false} value={JSON.stringify(value, null, 2)} onInput={event => {
    try { onChange(jsonObject(JSON.parse(event.currentTarget.value || '{}'))); event.currentTarget.classList.remove('bad-json'); }
    catch { event.currentTarget.classList.add('bad-json'); }
  }} />;
}
