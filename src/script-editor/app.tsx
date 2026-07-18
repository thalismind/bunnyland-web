import { EmptyState } from '@bunnyland/ui-web/preact';
import { render } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { BlockList, type ScriptBlockItem } from './block-list';

type JsonObject = Record<string, unknown>;

interface ScriptTarget {
  bind?: string;
  mode?: string;
  query?: JsonObject;
}

interface SubmitAction {
  _key: string;
  command_type?: string;
  cost?: { action?: number; focus?: number };
  kind: 'submit_command';
  lane?: string;
  on_insufficient_points?: string;
  payload?: JsonObject;
  target?: ScriptTarget;
}

interface PatchAction {
  _key: string;
  kind: 'patch_world';
  operations?: unknown[];
}

type ScriptAction = SubmitAction | PatchAction;

interface ScriptTrigger extends JsonObject {
  all?: unknown;
  any?: unknown;
  epoch_at_least?: number;
  event_fields?: JsonObject;
  event_type?: string;
  not?: unknown;
  tick?: boolean;
}

interface EditorBlock {
  _key: string;
  actions: ScriptAction[];
  cooldown_seconds: number;
  execution: string;
  name: string;
  priority: number;
  trigger: ScriptTrigger;
}

interface EditorScript {
  bindings: Record<string, string>;
  blocks: EditorBlock[];
  id: string;
  name: string;
  version: string;
}

interface WorldEntity {
  components: Record<string, JsonObject>;
  id: string;
}

interface ParsedWorld {
  entities: Record<string, WorldEntity>;
  epoch: number;
  meta?: { generator?: string; seed?: string };
}

interface BunnylandWorldClient {
  controlInfo(entity: WorldEntity, world: ParsedWorld): { kind?: string } | null;
  entityDisplayName(entity: WorldEntity): string;
  entityIcon(entity: WorldEntity): string;
  entityType(entity: WorldEntity): string;
  parseSnapshot(snapshot: unknown): ParsedWorld;
}

const scriptGlobals = globalThis as typeof globalThis & {
  BunnylandUI: { initClientMenu(): void };
  BunnylandWorld: BunnylandWorldClient;
};

let nextKey = 0;
function key(prefix: string): string {
  return `${prefix}:${++nextKey}`;
}

function makeDefaultScript(): EditorScript {
  return { bindings: {}, blocks: [], id: 'local.script', name: 'Local Script', version: '0.1.0' };
}

function makeDefaultBlock(index: number): EditorBlock {
  return {
    _key: key('block'), actions: [], cooldown_seconds: 0, execution: 'once',
    name: `block_${index}`, priority: 0, trigger: { tick: true },
  };
}

function makeDefaultSubmitAction(): SubmitAction {
  return {
    _key: key('action'), command_type: 'say', cost: { action: 0, focus: 0 }, kind: 'submit_command',
    lane: 'world', on_insufficient_points: 'queue', payload: { text: '' },
    target: { bind: 'actor', mode: 'one', query: { components: ['CharacterComponent'] } },
  };
}

function makeDefaultPatchAction(): PatchAction {
  return {
    _key: key('action'), kind: 'patch_world', operations: [{
      bind: 'new_entity', components: [{
        fields: { kind: 'marker', name: 'new marker' }, type: 'IdentityComponent',
      }], op: 'add_entity',
    }],
  };
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function parseJsonObject(text: string, fallback: JsonObject): JsonObject {
  if (!text.trim()) return fallback;
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected JSON object');
  return parsed as JsonObject;
}

function parseJsonArray(text: string, fallback: unknown[]): unknown[] {
  if (!text.trim()) return fallback;
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('expected JSON array');
  return parsed;
}

function normalizeAction(value: unknown): ScriptAction {
  const action = asObject(value);
  if (action.kind === 'patch_world') {
    return { _key: key('action'), kind: 'patch_world', operations: Array.isArray(action.operations) ? action.operations : [] };
  }
  const target = asObject(action.target);
  const cost = asObject(action.cost);
  return {
    _key: key('action'),
    command_type: String(action.command_type ?? ''),
    cost: { action: Number(cost.action ?? 0), focus: Number(cost.focus ?? 0) },
    kind: 'submit_command',
    lane: String(action.lane ?? 'world'),
    on_insufficient_points: String(action.on_insufficient_points ?? 'queue'),
    payload: asObject(action.payload),
    target: {
      bind: String(target.bind ?? 'actor'), mode: String(target.mode ?? 'one'), query: asObject(target.query),
    },
  };
}

export function normalizeScript(value: unknown): EditorScript {
  const data = asObject(value);
  const bindings = Object.fromEntries(Object.entries(asObject(data.bindings)).map(([name, id]) => [name, String(id)]));
  const blocks = Array.isArray(data.blocks) ? data.blocks.map((item, index): EditorBlock => {
    const block = asObject(item);
    return {
      _key: key('block'),
      actions: Array.isArray(block.actions) ? block.actions.map(normalizeAction) : [],
      cooldown_seconds: Number(block.cooldown_seconds ?? 0),
      execution: String(block.execution ?? 'once'),
      name: String(block.name || `block_${index + 1}`),
      priority: Number(block.priority ?? 0),
      trigger: asObject(block.trigger) as ScriptTrigger,
    };
  }) : [];
  return {
    bindings, blocks, id: String(data.id || 'local.script'), name: String(data.name ?? ''),
    version: String(data.version || '0.1.0'),
  };
}

function scriptForExport(script: EditorScript): JsonObject {
  return {
    bindings: script.bindings,
    blocks: script.blocks.map(block => ({
      actions: block.actions.map(action => action.kind === 'patch_world'
        ? { kind: action.kind, operations: action.operations ?? [] }
        : {
          command_type: action.command_type ?? '', cost: action.cost ?? { action: 0, focus: 0 },
          kind: action.kind, lane: action.lane ?? 'world',
          on_insufficient_points: action.on_insufficient_points ?? 'queue', payload: action.payload ?? {},
          target: action.target ?? { bind: 'actor', mode: 'one', query: {} },
        }),
      cooldown_seconds: Number(block.cooldown_seconds || 0), execution: block.execution || 'once',
      name: block.name, priority: Number(block.priority || 0), trigger: block.trigger || { tick: true },
    })),
    id: script.id || 'local.script', name: script.name || '', version: script.version || '0.1.0',
  };
}

export function validateScript(script: EditorScript): string[] {
  const problems: string[] = [];
  if (!script.id) problems.push('script.id is required');
  const seen = new Set<string>();
  script.blocks.forEach((block, index) => {
    if (!block.name) problems.push(`blocks[${index}].name is required`);
    if (seen.has(block.name)) problems.push(`duplicate block name: ${block.name}`);
    seen.add(block.name);
    if (!block.trigger || Object.keys(block.trigger).length === 0) problems.push(`${block.name}: trigger is required`);
    block.actions.forEach((action, actionIndex) => {
      if (action.kind === 'submit_command') {
        if (!action.command_type) problems.push(`${block.name}: submit_command requires command_type`);
        if (!action.target?.query) problems.push(`${block.name}: submit_command requires target.query`);
      } else if (!action.kind) {
        problems.push(`${block.name}: actions[${actionIndex}].kind is required`);
      }
    });
  });
  return problems;
}

function triggerType(trigger: ScriptTrigger): 'epoch' | 'event' | 'raw' | 'tick' {
  if (trigger.epoch_at_least != null) return 'epoch';
  if (trigger.event_type != null) return 'event';
  if (trigger.all || trigger.any || trigger.not) return 'raw';
  return 'tick';
}

function triggerLabel(trigger: ScriptTrigger): string {
  if (trigger.tick) return 'tick';
  if (trigger.epoch_at_least != null) return `epoch >= ${trigger.epoch_at_least}`;
  if (trigger.event_type) return trigger.event_type;
  if (trigger.all) return 'all';
  if (trigger.any) return 'any';
  if (trigger.not) return 'not';
  return 'trigger';
}

function entityName(entity: WorldEntity): string {
  return scriptGlobals.BunnylandWorld.entityDisplayName(entity);
}

function controlKind(entity: WorldEntity, world: ParsedWorld): string {
  return scriptGlobals.BunnylandWorld.controlInfo(entity, world)?.kind ?? '';
}

function entitySubtitle(entity: WorldEntity, world: ParsedWorld): string {
  const room = entity.components.RoomComponent;
  if (room) return [room.biome, room.indoor ? 'indoor' : 'outdoor'].filter(Boolean).join(' · ');
  const character = entity.components.CharacterComponent;
  if (character) return [character.species || 'character', controlKind(entity, world)].filter(Boolean).join(' · ');
  const identity = entity.components.IdentityComponent;
  if (identity) return String(identity.kind ?? '');
  return Object.keys(entity.components).slice(0, 3).join(', ');
}

function TriggerEditor({ trigger, onChange }: { trigger: ScriptTrigger; onChange(trigger: ScriptTrigger): void }) {
  const type = triggerType(trigger);
  const source = JSON.stringify(type === 'raw' ? trigger : (trigger.event_fields ?? {}), null, 2);
  const [json, setJson] = useState(source);
  const [bad, setBad] = useState(false);
  useLayoutEffect(() => { setJson(source); setBad(false); }, [source]);

  const updateJson = (text: string) => {
    setJson(text);
    try {
      const parsed = parseJsonObject(text, type === 'raw' ? { tick: true } : {});
      setBad(false);
      onChange(type === 'raw' ? parsed as ScriptTrigger : { ...trigger, event_fields: parsed });
    } catch {
      setBad(true);
    }
  };

  return <div class="form-grid">
    <label class="field">Type
      <select id="trigger-type" value={type} onChange={event => {
        const next = event.currentTarget.value;
        if (next === 'epoch') onChange({ epoch_at_least: 0 });
        else if (next === 'event') onChange({ event_fields: {}, event_type: 'DomainEvent' });
        else if (next === 'raw') onChange({ all: [] });
        else onChange({ tick: true });
      }}>
        <option value="tick">tick</option><option value="epoch">epoch_at_least</option>
        <option value="event">event</option><option value="raw">raw JSON</option>
      </select>
    </label>
    <label class="field">Epoch
      <input id="trigger-epoch" type="number" min="0" value={trigger.epoch_at_least ?? 0}
        onInput={event => onChange({ epoch_at_least: Number(event.currentTarget.value || 0) })} />
    </label>
    <label class="field wide">Event Type
      <input id="trigger-event" type="text" value={trigger.event_type ?? ''} spellcheck={false}
        onInput={event => onChange({ event_fields: trigger.event_fields ?? {}, event_type: event.currentTarget.value.trim() || 'DomainEvent' })} />
    </label>
    <label class="field full">Event Fields / Raw Trigger
      <textarea id="trigger-json" class={bad ? 'bad-json' : ''} spellcheck={false} value={json}
        onInput={event => updateJson(event.currentTarget.value)} />
    </label>
  </div>;
}

function ActionEditor({ action, index, onChange, onDelete }: {
  action: ScriptAction;
  index: number;
  onChange(action: ScriptAction): void;
  onDelete(): void;
}) {
  const patchSource = action.kind === 'patch_world' ? JSON.stringify(action.operations ?? [], null, 2) : '';
  const querySource = action.kind === 'submit_command' ? JSON.stringify(action.target?.query ?? {}, null, 2) : '';
  const payloadSource = action.kind === 'submit_command' ? JSON.stringify(action.payload ?? {}, null, 2) : '';
  const [patchText, setPatchText] = useState(patchSource);
  const [queryText, setQueryText] = useState(querySource);
  const [payloadText, setPayloadText] = useState(payloadSource);
  const [badPatch, setBadPatch] = useState(false);
  const [badQuery, setBadQuery] = useState(false);
  const [badPayload, setBadPayload] = useState(false);
  useLayoutEffect(() => { setPatchText(patchSource); setBadPatch(false); }, [patchSource]);
  useLayoutEffect(() => { setQueryText(querySource); setBadQuery(false); }, [querySource]);
  useLayoutEffect(() => { setPayloadText(payloadSource); setBadPayload(false); }, [payloadSource]);

  if (action.kind === 'patch_world') {
    return <div class="action-card" data-action={index}>
      <div class="action-head">patch_world <button data-delete-action={index} onClick={onDelete}>Delete</button></div>
      <div class="action-body"><label class="field full">Operations
        <textarea class={`action-ops ${badPatch ? 'bad-json' : ''}`} spellcheck={false} value={patchText}
          onInput={event => {
            const text = event.currentTarget.value;
            setPatchText(text);
            try { onChange({ ...action, operations: parseJsonArray(text, []) }); setBadPatch(false); }
            catch { setBadPatch(true); }
          }} />
      </label></div>
    </div>;
  }

  const target = action.target ?? { bind: 'actor', mode: 'one', query: {} };
  const update = (patch: Partial<SubmitAction>) => onChange({ ...action, ...patch });
  return <div class="action-card" data-action={index}>
    <div class="action-head">submit_command <button data-delete-action={index} onClick={onDelete}>Delete</button></div>
    <div class="action-body"><div class="form-grid">
      <label class="field">Mode
        <select class="target-mode" value={target.mode ?? 'one'} onChange={event => update({ target: { ...target, mode: event.currentTarget.value } })}>
          <option value="one">one</option><option value="first">first</option><option value="each">each</option>
        </select>
      </label>
      <label class="field">Bind<input class="target-bind" type="text" value={target.bind ?? 'actor'} spellcheck={false}
        onInput={event => update({ target: { ...target, bind: event.currentTarget.value.trim() || 'actor' } })} /></label>
      <label class="field wide">Command<input class="command-type" type="text" value={action.command_type ?? ''} spellcheck={false}
        onInput={event => update({ command_type: event.currentTarget.value.trim() })} /></label>
      <label class="field">Lane<select class="command-lane" value={action.lane ?? 'world'}
        onChange={event => update({ lane: event.currentTarget.value })}><option value="world">world</option><option value="focus">focus</option></select></label>
      <label class="field">On Points<select class="command-points" value={action.on_insufficient_points ?? 'queue'}
        onChange={event => update({ on_insufficient_points: event.currentTarget.value })}><option value="queue">queue</option><option value="deny">deny</option></select></label>
      <label class="field">Action Cost<input class="cost-action" type="number" min="0" value={action.cost?.action ?? 0}
        onInput={event => update({ cost: { ...action.cost, action: Number(event.currentTarget.value || 0) } })} /></label>
      <label class="field">Focus Cost<input class="cost-focus" type="number" min="0" value={action.cost?.focus ?? 0}
        onInput={event => update({ cost: { ...action.cost, focus: Number(event.currentTarget.value || 0) } })} /></label>
      <label class="field full">Target Query<textarea class={`target-query ${badQuery ? 'bad-json' : ''}`} spellcheck={false} value={queryText}
        onInput={event => {
          const text = event.currentTarget.value;
          setQueryText(text);
          try { update({ target: { ...target, query: parseJsonObject(text, {}) } }); setBadQuery(false); }
          catch { setBadQuery(true); }
        }}>{queryText}</textarea></label>
      <label class="field full">Payload<textarea class={`command-payload ${badPayload ? 'bad-json' : ''}`} spellcheck={false} value={payloadText}
        onInput={event => {
          const text = event.currentTarget.value;
          setPayloadText(text);
          try { update({ payload: parseJsonObject(text, {}) }); setBadPayload(false); }
          catch { setBadPayload(true); }
        }} /></label>
    </div></div>
  </div>;
}

function BlockEditor({ block, onChange }: { block: EditorBlock; onChange(block: EditorBlock): void }) {
  const updateAction = (index: number, action: ScriptAction) => {
    onChange({ ...block, actions: block.actions.map((item, itemIndex) => itemIndex === index ? action : item) });
  };
  return <>
    <div class="form-section">
      <div class="section-title">Block</div>
      <div class="form-grid">
        <label class="field wide">Name<input id="block-name" type="text" value={block.name} spellcheck={false}
          onInput={event => onChange({ ...block, name: event.currentTarget.value.trim() || block.name })} /></label>
        <label class="field">Priority<input id="block-priority" type="number" value={block.priority}
          onInput={event => onChange({ ...block, priority: Number(event.currentTarget.value || 0) })} /></label>
        <label class="field">Execution<select id="block-execution" value={block.execution}
          onChange={event => onChange({ ...block, execution: event.currentTarget.value })}><option value="once">once</option><option value="always">always</option></select></label>
        <label class="field">Cooldown<input id="block-cooldown" type="number" min="0" value={block.cooldown_seconds}
          onInput={event => onChange({ ...block, cooldown_seconds: Number(event.currentTarget.value || 0) })} /></label>
      </div>
    </div>
    <div class="form-section"><div class="section-title">Trigger</div>
      <TriggerEditor trigger={block.trigger} onChange={trigger => onChange({ ...block, trigger })} />
    </div>
    <div class="form-section">
      <div class="section-title">Actions</div>
      <div id="action-list">{block.actions.map((action, index) => <ActionEditor action={action} index={index} key={action._key}
        onChange={next => updateAction(index, next)}
        onDelete={() => onChange({ ...block, actions: block.actions.filter((_, itemIndex) => itemIndex !== index) })} />)}</div>
      <div class="button-row">
        <button id="btn-add-submit" onClick={() => onChange({ ...block, actions: [...block.actions, makeDefaultSubmitAction()] })}>Add submit_command</button>
        <button id="btn-add-patch" onClick={() => onChange({ ...block, actions: [...block.actions, makeDefaultPatchAction()] })}>Add patch_world</button>
      </div>
    </div>
  </>;
}

export function ScriptEditorPage() {
  const [world, setWorld] = useState<ParsedWorld | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [entitySearch, setEntitySearch] = useState('');
  const [script, setScript] = useState<EditorScript>(makeDefaultScript);
  const [selectedBlock, setSelectedBlock] = useState(0);
  const [status, setStatus] = useState({ kind: '', text: 'Ready' });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    scriptGlobals.BunnylandUI.initClientMenu();
    return () => { mountedRef.current = false; };
  }, []);

  const entities = useMemo(() => world
    ? Object.values(world.entities).sort((a, b) => entityName(a).localeCompare(entityName(b)))
    : [], [world]);
  const filteredEntities = useMemo(() => {
    const query = entitySearch.trim().toLowerCase();
    if (!query || !world) return entities;
    return entities.filter(entity => [
      entity.id, entityName(entity), entitySubtitle(entity, world),
      scriptGlobals.BunnylandWorld.entityType(entity), ...Object.keys(entity.components),
    ].join(' ').toLowerCase().includes(query));
  }, [entities, entitySearch, world]);
  const selectedEntity = world && selectedEntityId ? world.entities[selectedEntityId] : undefined;
  const currentBlock = script.blocks[selectedBlock];
  const exported = useMemo(() => scriptForExport(script), [script]);
  const json = useMemo(() => JSON.stringify(exported, null, 2), [exported]);
  const problems = useMemo(() => validateScript(script), [script]);
  const blockItems = useMemo<ScriptBlockItem[]>(() => script.blocks.map(block => ({
    key: block._key, meta: `${triggerLabel(block.trigger)} · ${block.execution || 'once'}`, name: block.name,
  })), [script.blocks]);

  const updateBlock = useCallback((block: EditorBlock) => {
    setScript(current => ({ ...current, blocks: current.blocks.map((item, index) => index === selectedBlock ? block : item) }));
  }, [selectedBlock]);

  const loadSnapshot = async (file: File) => {
    try {
      const parsed = scriptGlobals.BunnylandWorld.parseSnapshot(JSON.parse(await file.text()));
      if (!mountedRef.current) return;
      const sorted = Object.values(parsed.entities).sort((a, b) => entityName(a).localeCompare(entityName(b)));
      setWorld(parsed);
      setSelectedEntityId(sorted[0]?.id ?? null);
      setStatus({ kind: 'ok', text: 'Snapshot loaded' });
    } catch (error) {
      if (mountedRef.current) setStatus({ kind: 'err', text: `Snapshot error: ${error instanceof Error ? error.message : String(error)}` });
    }
  };

  const loadScript = async (file: File) => {
    try {
      const next = normalizeScript(JSON.parse(await file.text()));
      if (!mountedRef.current) return;
      setScript(next);
      setSelectedBlock(0);
      setStatus({ kind: 'ok', text: 'Script loaded' });
    } catch (error) {
      if (mountedRef.current) setStatus({ kind: 'err', text: `Script error: ${error instanceof Error ? error.message : String(error)}` });
    }
  };

  const applyEntityQuery = (query: JsonObject) => {
    if (!currentBlock) return;
    const actionIndex = currentBlock.actions.findIndex(action => action.kind === 'submit_command');
    if (actionIndex < 0) {
      setStatus({ kind: 'err', text: 'Add a submit_command action first' });
      return;
    }
    const action = currentBlock.actions[actionIndex] as SubmitAction;
    const nextAction: SubmitAction = { ...action, target: { ...(action.target ?? {}), query } };
    updateBlock({ ...currentBlock, actions: currentBlock.actions.map((item, index) => index === actionIndex ? nextAction : item) });
    setStatus({ kind: 'ok', text: 'Target query updated' });
  };

  const bindEntity = () => {
    if (!selectedEntity) return;
    const suggestion = entityName(selectedEntity).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'entity';
    const name = window.prompt('Binding name', suggestion);
    if (!name) return;
    setScript(current => ({ ...current, bindings: { ...current.bindings, [name]: selectedEntity.id } }));
    setStatus({ kind: 'ok', text: `Bound $${name}` });
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(script.id || 'script').replace(/[^a-zA-Z0-9_.-]+/g, '_')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus({ kind: 'ok', text: 'JSON downloaded' });
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(json); if (mountedRef.current) setStatus({ kind: 'ok', text: 'JSON copied' }); }
    catch { if (mountedRef.current) setStatus({ kind: 'err', text: 'Clipboard unavailable' }); }
  };

  const worldInfo = world
    ? `${entities.length} entities · epoch ${world.epoch}${[world.meta?.generator, world.meta?.seed].filter(Boolean).length ? ` · ${[world.meta?.generator, world.meta?.seed].filter(Boolean).join(' · ')}` : ''}`
    : 'No snapshot loaded';

  return <>
    <div id="toolbar">
      <div class="toolbar-row" id="toolbar-row1">
        <span class="toolbar-brand"><img src="favicon.png" alt="" /> Bunnyland Script Editor</span>
        <span class="toolbar-sep">|</span>
        <label for="snapshot-input">Snapshot:</label>
        <input type="file" id="snapshot-input" accept=".json,application/json" onChange={event => {
          const file = event.currentTarget.files?.[0]; if (file) void loadSnapshot(file);
        }} />
        <span class="toolbar-sep">|</span>
        <label for="script-input">Script:</label>
        <input type="file" id="script-input" accept=".json,application/json" onChange={event => {
          const file = event.currentTarget.files?.[0]; if (file) void loadScript(file);
        }} />
        <button id="btn-new" onClick={() => { setScript(makeDefaultScript()); setSelectedBlock(0); setStatus({ kind: 'ok', text: 'New script' }); }}>New</button>
        <button id="btn-download" onClick={download}>Download JSON</button>
        <button id="btn-copy" onClick={() => { void copy(); }}>Copy JSON</button>
        <span id="save-status" class={status.kind}>{status.text}</span>
        <button id="btn-client-menu" class="client-menu-button" type="button">Menu</button>
      </div>
      <div class="toolbar-row" id="toolbar-row2">
        <label for="script-id">ID:</label><input type="text" id="script-id" value={script.id} spellcheck={false}
          onInput={event => setScript(current => ({ ...current, id: event.currentTarget.value }))} />
        <label for="script-name">Name:</label><input type="text" id="script-name" value={script.name} spellcheck={false}
          onInput={event => setScript(current => ({ ...current, name: event.currentTarget.value }))} />
        <label for="script-version">Version:</label><input type="text" id="script-version" value={script.version} spellcheck={false}
          onInput={event => setScript(current => ({ ...current, version: event.currentTarget.value }))} />
        <span class="toolbar-sep">|</span><span id="world-info">{worldInfo}</span>
      </div>
    </div>

    <div id="main" class="app-grid">
      <section class="pane" id="library-pane">
        <div class="pane-header"><div class="pane-title">Entity Library</div><span class="pane-count" id="entity-count">{filteredEntities.length}/{entities.length}</span></div>
        <div class="pane-body">
          <input type="text" id="entity-search" placeholder="find entity..." spellcheck={false} autocomplete="off" value={entitySearch}
            onInput={event => setEntitySearch(event.currentTarget.value)} />
          <div id="entity-list">{filteredEntities.length === 0
            ? <EmptyState>{world ? 'No matching entities.' : 'Load a snapshot.'}</EmptyState>
            : filteredEntities.map(entity => <div class={`entity-row ${entity.id === selectedEntityId ? 'active' : ''}`} data-id={entity.id} key={entity.id}
              onClick={() => setSelectedEntityId(entity.id)}>
              <div>{scriptGlobals.BunnylandWorld.entityIcon(entity)}</div><div>
                <div class="entity-name">{entityName(entity)}</div>
                <div class="entity-meta">{scriptGlobals.BunnylandWorld.entityType(entity)}{world && entitySubtitle(entity, world) ? ` · ${entitySubtitle(entity, world)}` : ''}</div>
              </div>
            </div>)}</div>
          <div id="entity-detail">{!world || !selectedEntity ? <EmptyState>No entity selected.</EmptyState> : <>
            <div class="detail-title">{scriptGlobals.BunnylandWorld.entityIcon(selectedEntity)} {entityName(selectedEntity)}</div>
            <div class="detail-id">{selectedEntity.id}</div>
            <div class="pill-row"><span class="pill">{scriptGlobals.BunnylandWorld.entityType(selectedEntity)}</span>
              {controlKind(selectedEntity, world) ? <span class="pill">{controlKind(selectedEntity, world)}</span> : null}</div>
            <div class="tiny">components</div>
            <div class="pill-row">{Object.keys(selectedEntity.components).sort().map(name => <span class="pill" key={name}>{name}</span>)}</div>
            <div class="mini-actions">
              <button data-use="id" onClick={() => applyEntityQuery({ id: selectedEntity.id })}>Use ID</button>
              <button data-use="identity" onClick={() => {
                const identity = selectedEntity.components.IdentityComponent;
                if (identity?.name) applyEntityQuery({ identity_kind: identity.kind ?? '', identity_name: identity.name });
              }}>Use Name</button>
              <button data-use="room" onClick={() => {
                const room = selectedEntity.components.RoomComponent;
                if (room?.title) applyEntityQuery({ components: ['RoomComponent'], room_title: room.title });
              }}>Use Room</button>
              <button data-use="binding" onClick={bindEntity}>Bind Entity</button>
            </div>
          </>}</div>
        </div>
      </section>

      <section class="pane" id="editor-pane">
        <div class="pane-header"><div class="pane-title">Blocks</div><span class="pane-count" id="block-count">{script.blocks.length}</span>
          <button id="btn-add-block" onClick={() => {
            const block = makeDefaultBlock(script.blocks.length + 1);
            setScript(current => ({ ...current, blocks: [...current.blocks, block] }));
            setSelectedBlock(script.blocks.length);
          }}>Add Block</button>
          <button id="btn-delete-block" disabled={script.blocks.length === 0} onClick={() => {
            setScript(current => ({ ...current, blocks: current.blocks.filter((_, index) => index !== selectedBlock) }));
            setSelectedBlock(Math.max(0, Math.min(selectedBlock, script.blocks.length - 2)));
          }}>Delete</button>
        </div>
        <div id="editor-grid">
          <div id="block-list"><BlockList blocks={blockItems} selectedIndex={selectedBlock} onSelect={setSelectedBlock} /></div>
          <div class="editor-scroll" id="block-editor">{currentBlock
            ? <BlockEditor block={currentBlock} onChange={updateBlock} />
            : <EmptyState>Add or select a block.</EmptyState>}</div>
        </div>
      </section>

      <section class="pane" id="preview-pane">
        <div class="pane-header"><div class="pane-title">JSON</div><span class="pane-count" id="json-size">{new Blob([json]).size} bytes</span></div>
        <textarea id="json-output" spellcheck={false} readOnly value={json} />
        <div id="problems" class={problems.length ? '' : 'ok'}>{problems.length
          ? problems.map(problem => <div key={problem}>{problem}</div>) : 'Valid script JSON.'}</div>
      </section>
    </div>
  </>;
}

const root = document.getElementById('app');
if (root) render(<ScriptEditorPage />, root);
