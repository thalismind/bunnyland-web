import { Button, EmptyState, Pane } from '@bunnyland/ui-web/preact';

import { EntityList } from './entity-list';
import { EntityEditor, type SendPatch, type Status } from './entity-editor';
import {
  entityDisplayName,
  entityIcon,
  entityType,
  hasInvalidTarget,
  type EditorWorld,
  type JsonObject,
  type ValidationProblem,
  type WorldCatalogue,
  type WorldEdge,
  type WorldEntity,
} from './models';

interface EditorLayoutProps {
  componentNames: string[];
  defaultComponent: (type: string, entity: WorldEntity) => JsonObject;
  defaultEdge: (type: string) => JsonObject;
  edgeNames: string[];
  entities: WorldEntity[];
  inspectorHref: string;
  jsonText: string;
  live: boolean;
  onAddEntity: () => void;
  onComponent: (type: string, fields: JsonObject) => void;
  onDeleteEntity: () => void;
  onEdge: (type: string, index: number, edge: WorldEdge) => void;
  onRevise: () => void;
  onSearch: (query: string) => void;
  onSelect: (id: string) => void;
  onStatus: (status: Status) => void;
  problems: ValidationProblem[];
  schema: WorldCatalogue | null;
  search: string;
  selected: WorldEntity | null;
  sendPatch: SendPatch;
  snapshotVisible: boolean;
  world: EditorWorld;
}

export function EditorLayout(props: EditorLayoutProps) {
  const { entities, jsonText, problems, selected, snapshotVisible, world } = props;
  return <div id="main" class={`app-grid${snapshotVisible ? '' : ' snapshot-hidden'}`}>
    <Pane title="Entities" tools={<><span class="pane-count" id="entity-count">{entities.length}/{Object.keys(world.entities).length}</span><Button id="btn-add-entity" onClick={props.onAddEntity}>Add</Button><Button id="btn-delete-entity" disabled={!selected} onClick={props.onDeleteEntity}>Delete</Button></>}>
      <div class="pane-body"><input type="text" id="entity-search" placeholder="find, type:, component:, invalid" spellcheck={false} autocomplete="off" value={props.search} onInput={event => props.onSearch(event.currentTarget.value)} /><div id="entity-list"><EntityList entities={entities.map(entity => ({ id: entity.id, icon: entityIcon(entity), invalid: hasInvalidTarget(entity, world), name: entityDisplayName(entity), type: entityType(entity) }))} selectedId={selected?.id || null} onSelect={props.onSelect} /></div></div>
    </Pane>
    <Pane title="Entity Editor" tools={<><span class="pane-count" id="selected-label">{selected?.id || 'No selection'}</span>{selected && <a class="nav-link push" id="inspector-link" href={props.inspectorHref}>Open World Graph</a>}</>}>
      <div class="editor-scroll" id="entity-editor">{selected ? <EntityEditor key={selected.id} entity={selected} componentNames={props.componentNames} edgeNames={props.edgeNames} schema={props.schema} world={world} onRevise={props.onRevise} onStatus={props.onStatus} onComponent={props.onComponent} onEdge={props.onEdge} onSelect={props.onSelect} sendPatch={props.sendPatch} defaultComponent={props.defaultComponent} defaultEdge={props.defaultEdge} live={props.live} /> : <EmptyState>Select or add an entity.</EmptyState>}</div>
    </Pane>
    <Pane id="preview-pane" title="Snapshot JSON" tools={<span class="pane-count" id="json-size">{new Blob([jsonText]).size} bytes</span>}>
      <textarea id="json-output" spellcheck={false} readOnly value={jsonText} />
      <div id="problems" class={problems.length ? '' : 'ok'}>{problems.length ? problems.map((problem, index) => <span key={`${problem.message}:${index}`}>{problem.entityId && world.entities[problem.entityId] ? <><Button class="problem-link" data-editor-entity={problem.entityId} onClick={() => props.onSelect(problem.entityId || '')}>{problem.entityId}</Button> {problem.message}</> : problem.message}{index < problems.length - 1 && <br />}</span>) : 'Valid world JSON.'}</div>
    </Pane>
  </div>;
}
