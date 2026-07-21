import { Button, EmptyState, SearchSelect } from '@bunnyland/ui-web/preact';
import { useRef, useState } from 'preact/hooks';

import { defaultFor, RawObject, SchemaField } from './fields';
import {
  entityDisplayName,
  type EditorWorld,
  type JsonObject,
  type JsonValue,
  type PatchOperation,
  type PatchResult,
  type WorldCatalogue,
  type WorldEdge,
  type WorldEntity,
} from './models';

export interface Status { kind: '' | 'err' | 'ok'; text: string }
export type SendPatch = (operations: PatchOperation[], merge?: boolean, text?: string) => Promise<PatchResult | null>;

interface ControlledSearchProps {
  disabled?: boolean;
  dropdownId: string;
  hiddenId: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  placeholder: string;
  value: string;
}

export function ControlledSearch({ disabled = false, dropdownId, hiddenId, onChange, options, placeholder, value }: ControlledSearchProps) {
  return <span id={dropdownId}>
    <SearchSelect disabled={disabled} id={`${hiddenId}-search`} options={options} placeholder={placeholder} value={value} onChange={onChange} />
    <input class="search-dropdown-value" id={hiddenId} type="hidden" value={value} />
  </span>;
}

interface ComponentCardProps {
  entity: WorldEntity;
  onChange: (type: string, fields: JsonObject) => void;
  onDelete: (type: string) => void;
  rootSchema: WorldCatalogue | null;
  type: string;
  worldEpoch: number;
}

function ComponentCard({ entity, onChange, onDelete, rootSchema, type, worldEpoch }: ComponentCardProps) {
  const fields = entity.components[type] || {};
  const schema = rootSchema?.components[type]?.json_schema;
  const update = (name: string, value: JsonValue): void => onChange(type, { ...fields, [name]: value });
  return <div class="record-card component-card" data-type={type}>
    <div class="record-head">{type} <Button data-delete-component={type} onClick={() => onDelete(type)}>Delete</Button></div>
    <div class="record-body">{schema?.properties ? <>
      <div class="form-grid typed-component-fields">{Object.entries(schema.properties).map(([name, raw]) => <SchemaField classPrefix="component" key={name} name={name} rawSchema={raw} root={schema} value={Object.hasOwn(fields, name) ? fields[name] : defaultFor(raw, schema)} worldEpoch={worldEpoch} onChange={value => update(name, value)} />)}</div>
      <details class="raw-json"><summary>Raw JSON</summary><RawObject className="component-json" value={fields} onChange={value => onChange(type, value)} /></details>
    </> : <label class="field full">Fields<RawObject className="component-json" value={fields} onChange={value => onChange(type, value)} /></label>}</div>
  </div>;
}

interface EdgeCardProps {
  edge: WorldEdge;
  index: number;
  onChange: (type: string, index: number, edge: WorldEdge) => void;
  onDelete: (type: string, index: number) => void;
  rootSchema: WorldCatalogue | null;
  type: string;
  worldEpoch: number;
}

function EdgeCard({ edge, index, onChange, onDelete, rootSchema, type, worldEpoch }: EdgeCardProps) {
  const fields = edge.edge;
  const schema = rootSchema?.edges[type]?.json_schema;
  const update = (name: string, value: JsonValue): void => onChange(type, index, { ...edge, edge: { ...fields, [name]: value } });
  return <div class="record-card edge-card" data-type={type} data-index={index}>
    <div class="record-head">{type} → {edge.target} <Button data-delete-edge={`${type}:${index}`} onClick={() => onDelete(type, index)}>Delete</Button></div>
    <div class="record-body"><div class="form-grid"><label class="field wide">Target<input class="edge-target" list="entity-options" type="text" value={edge.target} spellcheck={false} onInput={event => onChange(type, index, { ...edge, target: event.currentTarget.value.trim() })} /></label>
      {schema?.properties ? <div class="field full"><div class="form-grid typed-edge-fields">{Object.entries(schema.properties).map(([name, raw]) => <SchemaField classPrefix="edge" key={name} name={name} rawSchema={raw} root={schema} value={Object.hasOwn(fields, name) ? fields[name] : defaultFor(raw, schema)} worldEpoch={worldEpoch} onChange={value => update(name, value)} />)}</div><details class="raw-json"><summary>Raw JSON</summary><RawObject className="edge-json" value={fields} onChange={value => onChange(type, index, { ...edge, edge: value })} /></details></div>
        : <label class="field full">Edge Fields<RawObject className="edge-json" value={fields} onChange={value => onChange(type, index, { ...edge, edge: value })} /></label>}
    </div></div>
  </div>;
}

interface GenerationProps { entity: WorldEntity; live: boolean; onStatus: (status: Status) => void }

export function Generation({ entity, live, onStatus }: GenerationProps) {
  const sections = [];
  if (entity.components.DoorComponent) sections.push(<div class="record-card" key="room"><div class="record-head">Generate Room</div><div class="record-body"><div class="form-grid"><label class="field">Direction<input id="gen-room-direction" type="text" disabled={!live} /></label><label class="field full">Prompt / Theme<textarea id="gen-room-prompt" disabled={!live} /></label></div><div class="button-row"><Button id="btn-gen-room" disabled={!live} onClick={() => onStatus({ kind: 'err', text: 'Room generation requires live operator access' })}>Generate and Apply Room</Button></div></div></div>);
  if (entity.components.RoomComponent) sections.push(<div class="record-card" key="character"><div class="record-head">Generate Character</div><div class="record-body"><label class="field full">Prompt / Theme<textarea id="gen-character-prompt" disabled={!live} /></label><div class="button-row"><Button id="btn-gen-character" disabled={!live}>Generate and Apply Character</Button></div></div></div>);
  if (entity.components.RoomComponent || entity.components.CharacterComponent || entity.components.ContainerComponent) sections.push(<div class="record-card" key="item"><div class="record-head">Generate Item</div><div class="record-body"><label class="field full">Prompt / Theme<textarea id="gen-item-prompt" disabled={!live} /></label><div class="button-row"><Button id="btn-gen-item" disabled={!live}>Generate and Apply Item</Button></div></div></div>);
  return sections.length ? <div class="section"><div class="section-title">DM Generation</div>{sections}{!live && <div class="tiny">Load a server snapshot to generate live patches.</div>}</div> : null;
}

interface EntityEditorProps {
  componentNames: string[];
  defaultComponent: (type: string, entity: WorldEntity) => JsonObject;
  defaultEdge: (type: string) => JsonObject;
  edgeNames: string[];
  entity: WorldEntity;
  live: boolean;
  onComponent: (type: string, fields: JsonObject) => void;
  onEdge: (type: string, index: number, edge: WorldEdge) => void;
  onRevise: () => void;
  onSelect: (id: string) => void;
  onStatus: (status: Status) => void;
  schema: WorldCatalogue | null;
  sendPatch: SendPatch;
  world: EditorWorld;
}

export function EntityEditor({ componentNames, defaultComponent, defaultEdge, edgeNames, entity, live, onComponent, onEdge, onRevise, onSelect, onStatus, schema, sendPatch, world }: EntityEditorProps) {
  const idRef = useRef<HTMLInputElement>(null);
  const prefabRef = useRef<HTMLInputElement>(null);
  const createdRef = useRef<HTMLInputElement>(null);
  const [componentType, setComponentType] = useState('');
  const [edgeType, setEdgeType] = useState('');
  const [edgeTarget, setEdgeTarget] = useState('');
  const applyFields = (): void => {
    const nextId = idRef.current?.value.trim() || '';
    if (!nextId) { onStatus({ kind: 'err', text: 'Entity ID is required' }); return; }
    if (nextId !== entity.id && world.entities[nextId]) { onStatus({ kind: 'err', text: 'Entity ID already exists' }); return; }
    if (live && nextId !== entity.id) { onStatus({ kind: 'err', text: 'Live ECS entity IDs cannot be renamed' }); return; }
    entity.prefab = prefabRef.current?.value.trim() || 'entity';
    entity.created_epoch = Number(createdRef.current?.value || 0);
    if (nextId !== entity.id) {
      const oldId = entity.id;
      delete world.entities[oldId];
      entity.id = nextId;
      world.entities[nextId] = entity;
      for (const other of Object.values(world.entities)) for (const edges of Object.values(other.relationships)) for (const edge of edges) if (edge.target === oldId) edge.target = nextId;
      onSelect(nextId);
    } else onRevise();
    onStatus({ kind: 'ok', text: 'Entity updated' });
  };

  const addComponent = async (): Promise<void> => {
    if (!componentType || entity.components[componentType]) return;
    const fields = defaultComponent(componentType, entity);
    if (live) {
      try { await sendPatch([{ op: 'add_component', entity_id: entity.id, component: { type: componentType, fields } }], true, 'Component added'); }
      catch (error) { onStatus({ kind: 'err', text: `Patch error: ${errorMessage(error)}` }); return; }
    } else entity.components[componentType] = fields;
    setComponentType('');
    onRevise();
    onStatus({ kind: 'ok', text: 'Component added' });
  };
  const deleteComponent = async (type: string): Promise<void> => {
    if (live) {
      try { await sendPatch([{ op: 'remove_component', entity_id: entity.id, component_type: type }], true, 'Component deleted'); }
      catch (error) { onStatus({ kind: 'err', text: `Patch error: ${errorMessage(error)}` }); return; }
    }
    const current = world.entities[entity.id];
    if (current) delete current.components[type];
    onRevise();
    onStatus({ kind: 'ok', text: 'Component deleted' });
  };
  const addEdge = async (): Promise<void> => {
    if (!edgeType) { onStatus({ kind: 'err', text: 'Choose an edge type' }); return; }
    if (!edgeTarget) { onStatus({ kind: 'err', text: 'Choose a target entity' }); return; }
    const edge = defaultEdge(edgeType);
    if (live) {
      try { await sendPatch([{ op: 'set_edge', source_id: entity.id, target_id: edgeTarget, edge: { type: edgeType, fields: edge } }], true, 'Edge added'); }
      catch (error) { onStatus({ kind: 'err', text: `Patch error: ${errorMessage(error)}` }); return; }
    } else (entity.relationships[edgeType] ||= []).push({ target: edgeTarget, edge });
    setEdgeType('');
    setEdgeTarget('');
    onRevise();
    onStatus({ kind: 'ok', text: 'Edge added' });
  };
  const deleteEdge = async (type: string, index: number): Promise<void> => {
    const target = entity.relationships[type]?.[index]?.target;
    if (live && target) {
      try { await sendPatch([{ op: 'remove_edge', source_id: entity.id, target_id: target, edge_type: type }], true, 'Edge deleted'); }
      catch (error) { onStatus({ kind: 'err', text: `Patch error: ${errorMessage(error)}` }); return; }
    }
    const current = world.entities[entity.id];
    current?.relationships[type]?.splice(index, 1);
    if (current?.relationships[type] && !current.relationships[type].length) delete current.relationships[type];
    onRevise();
    onStatus({ kind: 'ok', text: 'Edge deleted' });
  };

  const componentOptions = componentNames.filter(name => !entity.components[name]);
  const targets = Object.values(world.entities).filter(target => target.id !== entity.id).sort((a, b) => entityDisplayName(a).localeCompare(entityDisplayName(b)));
  const edgeRows = Object.entries(entity.relationships).sort(([a], [b]) => a.localeCompare(b)).flatMap(([type, edges]) => edges.map((edge, index) => ({ edge, index, type })));
  return <>
    <div class="section"><div class="section-title">Entity</div><div class="form-grid"><label class="field wide">Entity ID<input id="entity-id" ref={idRef} type="text" defaultValue={entity.id} spellcheck={false} /></label><label class="field">Prefab<input id="entity-prefab" ref={prefabRef} type="text" defaultValue={entity.prefab} spellcheck={false} /></label><label class="field">Created Epoch<input id="entity-created" ref={createdRef} type="number" min="0" defaultValue={entity.created_epoch} /></label></div><div class="button-row"><Button id="btn-rename-entity" onClick={applyFields}>Apply Entity Fields</Button></div></div>
    <div class="section"><div class="section-title">Components <ControlledSearch disabled={!componentOptions.length} dropdownId="add-component-dropdown" hiddenId="add-component-type" options={componentOptions.map(name => ({ value: name, label: name }))} placeholder="find component..." value={componentType} onChange={setComponentType} /><Button id="btn-add-component" disabled={!componentOptions.length} onClick={() => { void addComponent(); }}>Add Component</Button></div><div id="component-list">{Object.keys(entity.components).length ? Object.keys(entity.components).sort().map(type => <ComponentCard entity={entity} key={type} onChange={onComponent} onDelete={type => { void deleteComponent(type); }} rootSchema={schema} type={type} worldEpoch={world.metadata.epoch} />) : <EmptyState>No components.</EmptyState>}</div></div>
    <Generation entity={entity} live={live} onStatus={onStatus} />
    <div class="section"><div class="section-title">Outgoing Edges <ControlledSearch disabled={!targets.length} dropdownId="add-edge-type-dropdown" hiddenId="add-edge-type" options={edgeNames.map(name => ({ value: name, label: name }))} placeholder="edge type..." value={edgeType} onChange={setEdgeType} /><ControlledSearch disabled={!targets.length} dropdownId="add-edge-target-dropdown" hiddenId="add-edge-target" options={targets.map(target => ({ value: target.id, label: `${entityDisplayName(target)} · ${target.id}` }))} placeholder="target entity..." value={edgeTarget} onChange={setEdgeTarget} /><Button id="btn-add-edge" disabled={!targets.length} onClick={() => { void addEdge(); }}>Add Edge</Button></div><div id="edge-list">{edgeRows.length ? edgeRows.map(({ edge, index, type }) => <EdgeCard edge={edge} index={index} key={`${type}:${index}:${edge.target}`} onChange={onEdge} onDelete={(value, item) => { void deleteEdge(value, item); }} rootSchema={schema} type={type} worldEpoch={world.metadata.epoch} />) : <EmptyState>No outgoing edges.</EmptyState>}</div></div>
  </>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
