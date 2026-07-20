import { AuthProvider, Button, useAuth } from '@bunnyland/ui-web/preact';
import { render } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { NamedList } from './library-list';

type NodeKind = 'action' | 'condition' | 'selector' | 'sequence';
type JsonObject = Record<string, unknown>;

export interface BehaviorNode {
  children?: BehaviorNode[];
  kind: NodeKind;
  params?: JsonObject;
  ref?: string;
}

export interface BehaviorSpec {
  description: string;
  name: string;
  root: BehaviorNode;
}

interface BehaviorApi {
  applyConfigToInput: (options: {
    connect: (server: string) => void;
    isConnected: () => boolean;
  }) => Promise<unknown>;
  applyServerParam: (options: { connect: (server: string) => void }) => string;
  normalizeBase: (base: string) => string;
  sendAdmin: (base: string, path: string, options: {
    body?: string;
    getAuth: () => string | null;
    method?: string;
    prompt?: boolean;
  }) => Promise<JsonObject>;
  setServerInUrl: (base: string) => void;
}

interface BehaviorUi {
  initClientMenu: () => unknown;
}

export interface BehaviorEditorRuntime {
  api: BehaviorApi;
  ui: BehaviorUi;
}

interface LiveAuth {
  authorized: boolean;
  request: () => void;
}

export const BUILTIN_CONDITIONS = ['has_open_exit', 'has_visible_characters', 'has_visible_objects'];
export const BUILTIN_ACTIONS = [
  'greet_first_character', 'move_first_exit', 'say', 'take_first_item', 'warn_first_character',
];

const PARAM_TEMPLATES: Record<string, JsonObject> = {
  say: { text: '', intent: 'praise', approach: 'friendly' },
};
const PARAM_HINTS: Record<string, string> = {
  say: 'text (required), intent (default praise), approach (default friendly)',
};
const COMPOSITE_KINDS = new Set<NodeKind>(['sequence', 'selector']);
const KINDS: NodeKind[] = ['sequence', 'selector', 'condition', 'action'];

export const DEFAULT_BEHAVIOR: BehaviorSpec = {
  name: 'local-behavior',
  description: '',
  root: {
    kind: 'selector',
    children: [
      {
        kind: 'sequence',
        children: [
          { kind: 'condition', ref: 'has_visible_objects', params: {} },
          { kind: 'action', ref: 'take_first_item', params: {} },
        ],
      },
      { kind: 'action', ref: 'move_first_exit', params: {} },
    ],
  },
};

function cloneBehavior(value: BehaviorSpec): BehaviorSpec {
  return JSON.parse(JSON.stringify(value)) as BehaviorSpec;
}

function defaultNode(kind: NodeKind): BehaviorNode {
  return COMPOSITE_KINDS.has(kind) ? { kind, children: [] } : { kind, ref: '', params: {} };
}

function nodeAt(root: BehaviorNode, path: string): BehaviorNode {
  let node = root;
  if (!path) return node;
  for (const part of path.split('.')) node = node.children?.[Number(part)] || node;
  return node;
}

function countNodes(node: BehaviorNode): number {
  return 1 + (node.children || []).reduce((total, child) => total + countNodes(child), 0);
}

function exportNode(node: BehaviorNode): BehaviorNode {
  if (COMPOSITE_KINDS.has(node.kind)) {
    return { kind: node.kind, children: (node.children || []).map(exportNode) };
  }
  return { kind: node.kind, ref: node.ref || '', params: node.params || {} };
}

export function normalizeBehavior(data: unknown): BehaviorSpec {
  const source = data && typeof data === 'object' ? data as JsonObject : {};
  const normalizeNode = (raw: unknown): BehaviorNode => {
    const value = raw && typeof raw === 'object' ? raw as JsonObject : {};
    const rawKind = value.kind;
    const kind: NodeKind = typeof rawKind === 'string' && KINDS.includes(rawKind as NodeKind)
      ? rawKind as NodeKind : 'selector';
    if (COMPOSITE_KINDS.has(kind)) {
      return { kind, children: Array.isArray(value.children) ? value.children.map(normalizeNode) : [] };
    }
    return {
      kind,
      ref: typeof value.ref === 'string' ? value.ref : '',
      params: value.params && typeof value.params === 'object' && !Array.isArray(value.params)
        ? value.params as JsonObject : {},
    };
  };
  return {
    name: typeof source.name === 'string' && source.name ? source.name : 'local-behavior',
    description: typeof source.description === 'string' ? source.description : '',
    root: source.root ? normalizeNode(source.root) : defaultNode('selector'),
  };
}

export function validateBehavior(
  spec: BehaviorSpec,
  badParams: ReadonlySet<string>,
  connected: boolean,
  conditions: readonly string[],
  actions: readonly string[],
): string[] {
  const problems: string[] = [];
  if (!spec.name) problems.push('name is required');
  if (badParams.size) problems.push('a node has invalid params JSON');
  const walk = (node: BehaviorNode, label: string): void => {
    if (COMPOSITE_KINDS.has(node.kind)) {
      const children = node.children || [];
      if (!children.length) problems.push(`${label}: ${node.kind} has no children`);
      children.forEach((child, index) => walk(child, `${label} › ${child.kind}[${index}]`));
      return;
    }
    if (!node.ref) {
      problems.push(`${label}: ${node.kind} leaf requires a library ref`);
    } else if (connected) {
      const library = node.kind === 'condition' ? conditions : actions;
      if (!library.includes(node.ref)) problems.push(`${label}: unknown ${node.kind} '${node.ref}'`);
    }
    if (node.ref === 'say' && !String(node.params?.text || '').trim()) {
      problems.push(`${label}: say requires a non-empty text param`);
    }
  };
  walk(spec.root, 'root');
  return problems;
}

interface TreeNodeProps {
  actions: readonly string[];
  conditions: readonly string[];
  drafts: Readonly<Record<string, string>>;
  invalid: ReadonlySet<string>;
  node: BehaviorNode;
  onAdd: (path: string, kind: NodeKind) => void;
  onDelete: (path: string) => void;
  onKind: (path: string, kind: NodeKind) => void;
  onParams: (path: string, text: string) => void;
  onRef: (path: string, ref: string) => void;
  path: string;
}

export function TreeNode(props: TreeNodeProps) {
  const { actions, conditions, drafts, invalid, node, path } = props;
  const composite = COMPOSITE_KINDS.has(node.kind);
  const refs = [...(node.kind === 'condition' ? conditions : actions)];
  if (node.ref && !refs.includes(node.ref)) refs.unshift(node.ref);
  return <div class={`bt-node kind-${node.kind}`} data-path={path} key={path || 'root'}>
    <div class="bt-head">
      <span class="bt-kind-badge">{node.kind}</span>
      <select class="node-kind" value={node.kind} onChange={event => props.onKind(path, event.currentTarget.value as NodeKind)}>
        {KINDS.map(kind => <option key={kind} value={kind}>{kind}</option>)}
      </select>
      <span class="bt-spacer" />
      {composite && KINDS.map(kind => <Button class="bt-add-btn" data-add={kind} key={kind} onClick={() => props.onAdd(path, kind)}>+ {kind}</Button>)}
      <Button class="node-delete danger" title={!path ? 'Reset the root node' : undefined} onClick={() => props.onDelete(path)}>{path ? 'Delete' : 'Reset'}</Button>
    </div>
    {composite ? <div class="bt-children">
      {(node.children || []).length
        ? (node.children || []).map((child, index) => {
          const childPath = path ? `${path}.${index}` : String(index);
          return <TreeNode {...props} node={child} path={childPath} key={childPath} />;
        })
        : <div class="empty">No children. Add a condition, action, sequence, or selector.</div>}
    </div> : <div class="bt-body">
      <label>Library ref
        <select class="node-ref" value={node.ref || ''} onChange={event => props.onRef(path, event.currentTarget.value)}>
          <option value="">— choose a {node.kind} —</option>
          {refs.map(ref => <option key={ref} value={ref}>{ref}</option>)}
        </select>
      </label>
      <label>Params (JSON)
        <textarea
          class={`node-params${invalid.has(path) ? ' bad-json' : ''}`}
          spellcheck={false}
          value={drafts[path] ?? JSON.stringify(node.params || {}, null, 2)}
          onInput={event => props.onParams(path, event.currentTarget.value)}
        />
      </label>
      {node.ref && PARAM_HINTS[node.ref] && <div class="param-hint">{PARAM_HINTS[node.ref]}</div>}
    </div>}
  </div>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function BehaviorEditorPage({ liveAuth, runtime }: { liveAuth?: LiveAuth; runtime: BehaviorEditorRuntime }) {
  const [behavior, setBehavior] = useState(() => cloneBehavior(DEFAULT_BEHAVIOR));
  const [conditions, setConditions] = useState([...BUILTIN_CONDITIONS]);
  const [actions, setActions] = useState([...BUILTIN_ACTIONS]);
  const [serverBehaviors, setServerBehaviors] = useState<string[]>([]);
  const [badParams, setBadParams] = useState<Set<string>>(() => new Set());
  const [paramDrafts, setParamDrafts] = useState<Record<string, string>>({});
  const [apiUrl, setApiUrl] = useState('/api/v1/');
  const [base, setBase] = useState('');
  const [connected, setConnected] = useState(false);
  const [saveStatus, setSaveStatus] = useState({ text: 'Ready', kind: '' });
  const [apiStatus, setApiStatus] = useState({ text: 'offline', kind: '' });
  const baseRef = useRef('');
  const authRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const liveAuthRef = useRef(liveAuth);
  const queuedServerRef = useRef('');
  liveAuthRef.current = liveAuth;

  const changeStructure = useCallback((update: (draft: BehaviorSpec) => void): void => {
    setBehavior(current => {
      const draft = cloneBehavior(current);
      update(draft);
      return draft;
    });
    setBadParams(new Set());
    setParamDrafts({});
  }, []);

  const addChild = useCallback((path: string, kind: NodeKind): void => {
    changeStructure((draft) => {
      const node = nodeAt(draft.root, path);
      node.children ||= [];
      node.children.push(defaultNode(kind));
    });
  }, [changeStructure]);

  const deleteNode = useCallback((path: string): void => {
    changeStructure((draft) => {
      if (!path) {
        draft.root = defaultNode('selector');
        return;
      }
      const parts = path.split('.');
      const index = Number(parts.pop());
      const parent = nodeAt(draft.root, parts.join('.'));
      parent.children?.splice(index, 1);
    });
  }, [changeStructure]);

  const setKind = useCallback((path: string, kind: NodeKind): void => {
    changeStructure((draft) => {
      const node = nodeAt(draft.root, path);
      if (node.kind === kind) return;
      node.kind = kind;
      if (COMPOSITE_KINDS.has(kind)) {
        delete node.ref;
        delete node.params;
        node.children ||= [];
      } else {
        delete node.children;
        node.ref ??= '';
        node.params ||= {};
      }
    });
  }, [changeStructure]);

  const setRef = useCallback((path: string, ref: string): void => {
    changeStructure((draft) => {
      const node = nodeAt(draft.root, path);
      node.ref = ref;
      if (PARAM_TEMPLATES[ref] && !Object.keys(node.params || {}).length) {
        node.params = { ...PARAM_TEMPLATES[ref] };
      }
    });
  }, [changeStructure]);

  const setParams = useCallback((path: string, text: string): void => {
    setParamDrafts(current => ({ ...current, [path]: text }));
    const trimmed = text.trim();
    if (!trimmed) {
      setBehavior(current => {
        const draft = cloneBehavior(current);
        nodeAt(draft.root, path).params = {};
        return draft;
      });
      setBadParams(current => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
      return;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected a JSON object');
      setBehavior(current => {
        const draft = cloneBehavior(current);
        nodeAt(draft.root, path).params = parsed as JsonObject;
        return draft;
      });
      setBadParams(current => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    } catch {
      setBadParams(current => new Set(current).add(path));
    }
  }, []);

  const spec = useMemo<BehaviorSpec>(() => ({
    name: behavior.name.trim(),
    description: behavior.description,
    root: exportNode(behavior.root),
  }), [behavior]);
  const json = useMemo(() => JSON.stringify(spec, null, 2), [spec]);
  const problems = useMemo(
    () => validateBehavior(spec, badParams, connected, conditions, actions),
    [actions, badParams, conditions, connected, spec],
  );

  const send = useCallback((server: string, path: string, options: { body?: string; method?: string; prompt?: boolean } = {}) => (
    runtime.api.sendAdmin(server, path, { ...options, getAuth: () => authRef.current })
  ), [runtime]);

  const refreshFrom = useCallback(async (server: string): Promise<void> => {
    const data = await send(server, '/admin/controller-definitions');
    if (!mountedRef.current) return;
    const nextConditions = Array.isArray(data.condition_library) ? data.condition_library.filter(item => typeof item === 'string') as string[] : [];
    const nextActions = Array.isArray(data.action_library) ? data.action_library.filter(item => typeof item === 'string') as string[] : [];
    const nextBehaviors = Array.isArray(data.behaviors) ? data.behaviors.filter(item => typeof item === 'string') as string[] : [];
    setConditions(nextConditions.length ? nextConditions.sort() : [...BUILTIN_CONDITIONS]);
    setActions(nextActions.length ? nextActions.sort() : [...BUILTIN_ACTIONS]);
    setServerBehaviors(nextBehaviors.sort());
  }, [send]);

  const disconnect = useCallback((): void => {
    baseRef.current = '';
    setBase('');
    setConnected(false);
    setConditions([...BUILTIN_CONDITIONS]);
    setActions([...BUILTIN_ACTIONS]);
    setServerBehaviors([]);
    setApiStatus({ text: 'offline', kind: '' });
    runtime.api.setServerInUrl('');
  }, [runtime]);

  const connect = useCallback(async (candidate: string, requestAuth = true): Promise<void> => {
    if (!mountedRef.current) return;
    const normalized = runtime.api.normalizeBase(candidate);
    if (!normalized) return;
    if (liveAuthRef.current && !liveAuthRef.current.authorized) {
      queuedServerRef.current = normalized;
      setApiUrl(normalized);
      setApiStatus({ text: 'login required', kind: '' });
      if (requestAuth) liveAuthRef.current.request();
      return;
    }
    queuedServerRef.current = '';
    baseRef.current = normalized;
    setBase(normalized);
    setApiUrl(normalized);
    setApiStatus({ text: 'connecting', kind: '' });
    try {
      await refreshFrom(normalized);
      if (!mountedRef.current || baseRef.current !== normalized) return;
      setConnected(true);
      setApiStatus({ text: 'live', kind: 'ok' });
      runtime.api.setServerInUrl(normalized);
      setSaveStatus({ text: 'Connected; library loaded from server', kind: 'ok' });
    } catch (error) {
      if (!mountedRef.current) return;
      baseRef.current = '';
      setBase('');
      setConnected(false);
      setApiStatus({ text: `error: ${errorMessage(error)}`, kind: 'err' });
      setSaveStatus({ text: `Connection error: ${errorMessage(error)}`, kind: 'err' });
    }
  }, [refreshFrom, runtime]);

  useEffect(() => {
    if (!liveAuth?.authorized || !queuedServerRef.current) return;
    const server = queuedServerRef.current;
    queuedServerRef.current = '';
    void connect(server, false);
  }, [connect, liveAuth?.authorized]);

  useEffect(() => {
    mountedRef.current = true;
    runtime.ui.initClientMenu();
    const connectTo = (server: string): void => {
      if (mountedRef.current) void connect(server, false);
    };
    void runtime.api.applyConfigToInput({
      connect: connectTo,
      isConnected: () => Boolean(baseRef.current),
    }).then((config) => {
      if (!mountedRef.current || baseRef.current || !config || typeof config !== 'object') return;
      const serverUrl = (config as { serverUrl?: unknown }).serverUrl;
      if (typeof serverUrl === 'string' && serverUrl) setApiUrl(serverUrl);
    });
    runtime.api.applyServerParam({ connect: connectTo });
    return () => { mountedRef.current = false; };
  }, [connect, runtime]);

  const register = async (): Promise<void> => {
    if (problems.length) {
      setSaveStatus({ text: 'Fix validation problems before registering', kind: 'err' });
      return;
    }
    if (!connected) {
      setSaveStatus({ text: 'Connect to a server first', kind: 'err' });
      return;
    }
    if (liveAuthRef.current && !liveAuthRef.current.authorized) {
      liveAuthRef.current.request();
      setSaveStatus({ text: 'Sign in with world administration access first', kind: 'err' });
      return;
    }
    try {
      const data = await send(
        base,
        `/admin/controller-definitions/behavior/${encodeURIComponent(spec.name)}`,
        { method: 'PUT', body: JSON.stringify({ definition: JSON.parse(json) }) },
      );
      if (!mountedRef.current) return;
      const names = Array.isArray(data.behaviors) ? data.behaviors.filter(item => typeof item === 'string') as string[] : [];
      setServerBehaviors(names.sort());
      setSaveStatus({ text: `Registered behavior '${spec.name}'`, kind: 'ok' });
    } catch (error) {
      if (mountedRef.current) setSaveStatus({ text: `Register failed: ${errorMessage(error)}`, kind: 'err' });
    }
  };

  const loadFile = async (file: File): Promise<void> => {
    try {
      setBehavior(normalizeBehavior(JSON.parse(await file.text()) as unknown));
      setBadParams(new Set());
      setParamDrafts({});
      setSaveStatus({ text: 'Behavior loaded', kind: 'ok' });
    } catch (error) {
      setSaveStatus({ text: `Load error: ${errorMessage(error)}`, kind: 'err' });
    }
  };

  const download = (): void => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(behavior.name || 'behavior').replace(/[^a-zA-Z0-9_.-]+/g, '_')}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    URL.revokeObjectURL(url);
    anchor.remove();
    setSaveStatus({ text: 'JSON downloaded', kind: 'ok' });
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(json);
      setSaveStatus({ text: 'JSON copied', kind: 'ok' });
    } catch {
      setSaveStatus({ text: 'Clipboard unavailable', kind: 'err' });
    }
  };

  return <>
    <div id="toolbar">
      <div class="toolbar-row toolbar-heading" id="toolbar-row1">
        <span class="toolbar-brand"><img src="favicon.png" alt="" /> Bunnyland Behavior Editor</span>
        <Button id="btn-client-menu" class="client-menu-button">Menu</Button>
      </div>
      <div class="toolbar-row" id="toolbar-row2">
        <label for="api-url">Server:</label>
        <input type="text" id="api-url" value={apiUrl} spellcheck={false} onInput={event => setApiUrl(event.currentTarget.value)} />
        <Button id="btn-connect" onClick={() => connected || base ? disconnect() : void connect(apiUrl.trim())}>{connected || base ? 'Disconnect' : liveAuth && !liveAuth.authorized ? 'Login for Live' : 'Connect'}</Button>
        <span id="api-status" class={apiStatus.kind}>{apiStatus.text}</span>
      </div>
      <div class="toolbar-row" id="toolbar-row3">
        <label for="behavior-input">Behavior:</label>
        <input type="file" id="behavior-input" accept=".json,application/json" onChange={event => {
          const file = event.currentTarget.files?.[0];
          if (file) void loadFile(file);
        }} />
        <Button id="btn-new" onClick={() => {
          setBehavior(cloneBehavior(DEFAULT_BEHAVIOR));
          setBadParams(new Set());
          setParamDrafts({});
          setSaveStatus({ text: 'New behavior', kind: 'ok' });
        }}>New</Button>
        <Button id="btn-download" onClick={download}>Download JSON</Button>
        <Button id="btn-copy" onClick={() => { void copy(); }}>Copy JSON</Button>
        <span id="save-status" class={saveStatus.kind}>{saveStatus.text}</span>
      </div>
      <div class="toolbar-row" id="toolbar-row4">
        <label for="behavior-name">Name:</label>
        <input type="text" id="behavior-name" value={behavior.name} spellcheck={false} onInput={event => setBehavior(current => ({ ...current, name: event.currentTarget.value }))} />
        <label for="behavior-desc">Description:</label>
        <input type="text" id="behavior-desc" value={behavior.description} spellcheck={false} onInput={event => setBehavior(current => ({ ...current, description: event.currentTarget.value }))} />
      </div>
    </div>

    <div id="main" class="app-grid">
      <section class="pane" id="library-pane">
        <div class="pane-header"><div class="pane-title">Leaf Library</div><span class="pane-count" id="library-source">{connected ? 'from server' : 'built-in'}</span></div>
        <div class="pane-body">
          <div class="lib-section">
            <div class="lib-title">Conditions</div>
            <div class="lib-hint">Reference these from a <b>condition</b> leaf via its <code>ref</code>.</div>
            <div class="pill-row" id="condition-list"><NamedList names={conditions} itemClass="pill" empty="none" /></div>
          </div>
          <div class="lib-section">
            <div class="lib-title">Actions</div>
            <div class="lib-hint">Reference these from an <b>action</b> leaf. <code>say</code> takes <code>text</code> (required), <code>intent</code>, <code>approach</code>.</div>
            <div class="pill-row" id="action-list"><NamedList names={actions} itemClass="pill" empty="none" /></div>
          </div>
          <div class="lib-section">
            <div class="lib-title">Registered behaviors</div>
            <div class="lib-hint">Names already in the connected server's registry. Pick a fresh name to add a new tree rather than shadowing a built-in.</div>
            <div id="behavior-list"><NamedList names={serverBehaviors} itemClass="behavior-name-row" empty="Connect to list." /></div>
          </div>
        </div>
      </section>

      <section class="pane" id="editor-pane">
        <div class="pane-header"><div class="pane-title">Behavior Tree</div><span class="pane-count" id="node-count">{countNodes(behavior.root)} nodes</span></div>
        <div class="editor-scroll" id="tree-scroll">
          <div id="tree-root"><TreeNode
            actions={actions} conditions={conditions} drafts={paramDrafts} invalid={badParams}
            node={behavior.root} path="" onAdd={addChild} onDelete={deleteNode}
            onKind={setKind} onParams={setParams} onRef={setRef}
          /></div>
        </div>
      </section>

      <section class="pane" id="preview-pane">
        <div class="pane-header">
          <div class="pane-title">JSON</div>
          <span class="pane-count" id="json-size">{new Blob([json]).size} bytes</span>
          <Button id="btn-register" class="push" disabled={!connected || problems.length > 0} onClick={() => { void register(); }}>Register on Server</Button>
        </div>
        <textarea id="json-output" spellcheck={false} readOnly value={json} />
        <div id="problems" class={problems.length ? '' : 'ok'}>
          {problems.length ? problems.map((problem, index) => <span key={problem}>{index > 0 && <br />}{problem}</span>) : 'Valid behavior JSON.'}
        </div>
      </section>
    </div>
  </>;
}

interface BrowserWindow extends Window {
  BunnylandApi: BehaviorApi;
  BunnylandUI: BehaviorUi;
}

const root = document.getElementById('app');
if (root) {
  const browserWindow = window as unknown as BrowserWindow;
  const runtime = { api: browserWindow.BunnylandApi, ui: browserWindow.BunnylandUI };
  function BehaviorEditorEntry() {
    const { hasScopes, openLogin, status } = useAuth();
    const authorized = status === 'authenticated' && hasScopes(['world:admin']);
    const request = useCallback((): void => openLogin(['world:admin']), [openLogin]);
    const liveAuth = useMemo<LiveAuth>(() => ({ authorized, request }), [authorized, request]);
    return <BehaviorEditorPage liveAuth={liveAuth} runtime={runtime} />;
  }
  const server = new URL(location.href).searchParams.get('server') || '/api/v1';
  render(<AuthProvider base={server}><BehaviorEditorEntry /></AuthProvider>, root);
}
