import { EmptyState } from '@bunnyland/ui-web/preact';
import { render } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { GeneratedEntityList, type GeneratedEntityItem } from './entity-list';

interface GeneratorDefinition {
  description?: string;
  name: string;
  uses_seed?: boolean;
}

interface WorldEntity {
  components?: Record<string, unknown>;
  id: string;
  kind?: string;
}

interface WorldSnapshot {
  entities?: WorldEntity[] | Record<string, Omit<WorldEntity, 'id'>>;
  metadata?: { generator?: string; seed?: string };
  world_epoch?: number;
}

interface ActivityItem {
  id: number;
  kind: '' | 'error' | 'ok';
  text: string;
  time: string;
}

interface GenerationStatus {
  characters?: number;
  error?: string;
  job_id?: string;
  rooms?: number;
  status?: string;
  world_epoch?: number;
}

interface SocketMessage {
  data?: Record<string, unknown>;
  type?: string;
}

interface BunnylandApiClient {
  applyConfigToInput(options: {
    connect(server: string): void;
    isConnected(): boolean;
  }): Promise<unknown>;
  applyServerParam(options: { connect(server: string): void }): string;
  normalizeBase(url: string): string;
  sendAdmin(base: string, path: string, options?: {
    body?: string | null | undefined;
    getAuth?: () => string | null;
    method?: string | undefined;
    prompt?: boolean | undefined;
  }): Promise<unknown>;
  sendJson(base: string, path: string, options?: {
    body?: string | null;
    method?: string;
  }): Promise<unknown>;
  setServerInUrl(base: string): void;
  socketUrl(base: string): string;
}

interface BunnylandWorldClient {
  entityDisplayName(entity: WorldEntity): string;
  entityType(entity: WorldEntity): string;
}

declare global {
  const BunnylandApi: BunnylandApiClient;
  const BunnylandUI: { initClientMenu(): void };
  const BunnylandWorld: BunnylandWorldClient;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function generatorUsesSeed(generator: GeneratorDefinition | undefined): boolean {
  if (!generator) return true;
  if (typeof generator.uses_seed === 'boolean') return generator.uses_seed;
  return generator.name !== 'empty' && !generator.name.endsWith('-demo');
}

function entityName(entity: WorldEntity): string {
  return BunnylandWorld.entityDisplayName(entity);
}

function entityKind(entity: WorldEntity): string {
  const type = BunnylandWorld.entityType(entity);
  return type !== 'other'
    ? type
    : (entity.kind ?? Object.keys(entity.components ?? {})[0] ?? 'entity');
}

function snapshotEntities(snapshot: WorldSnapshot): WorldEntity[] {
  if (Array.isArray(snapshot.entities)) return snapshot.entities;
  return Object.entries(snapshot.entities ?? {}).map(([id, entity]) => ({ id, ...entity }));
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Operation aborted', 'AbortError'));
    }, { once: true });
  });
}

export function WorldGeneratorPage() {
  const [base, setBase] = useState('');
  const [status, setStatus] = useState<{ kind: string; text: string }>({ kind: '', text: 'offline' });
  const [generators, setGenerators] = useState<GeneratorDefinition[]>([]);
  const [selectedGenerator, setSelectedGenerator] = useState('');
  const [seed, setSeed] = useState('a quiet marsh');
  const [maxRooms, setMaxRooms] = useState('6');
  const [save, setSave] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [entities, setEntities] = useState<WorldEntity[]>([]);
  const [lastAdded, setLastAdded] = useState<Set<string>>(new Set());
  const [snapshot, setSnapshot] = useState<WorldSnapshot>({});
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const apiInputRef = useRef<HTMLInputElement>(null);
  const baseRef = useRef('');
  const entitiesRef = useRef<WorldEntity[]>([]);
  const busyRef = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);
  const generationRef = useRef<AbortController | null>(null);
  const activityIdRef = useRef(0);
  const mountedRef = useRef(true);

  const log = useCallback((text: string, kind: ActivityItem['kind'] = '') => {
    const item = { id: ++activityIdRef.current, kind, text, time: new Date().toLocaleTimeString() };
    setActivities(current => [item, ...current].slice(0, 80));
  }, []);

  const applySnapshot = useCallback((nextSnapshot: WorldSnapshot) => {
    const previous = new Set(entitiesRef.current.map(entity => entity.id));
    const nextEntities = snapshotEntities(nextSnapshot);
    entitiesRef.current = nextEntities;
    setEntities(nextEntities);
    setLastAdded(previous.size
      ? new Set(nextEntities.map(entity => entity.id).filter(id => !previous.has(id)))
      : new Set());
    setSnapshot(nextSnapshot);
  }, []);

  const sendAt = useCallback(async <T,>(server: string, path: string, options: {
    admin?: boolean;
    body?: string | null;
    method?: string;
    prompt?: boolean;
  } = {}): Promise<T> => {
    if (!options.admin) {
      return await BunnylandApi.sendJson(server, path, options) as T;
    }
    return await BunnylandApi.sendAdmin(server, path, {
      body: options.body,
      getAuth: () => null,
      method: options.method,
      prompt: options.prompt,
    }) as T;
  }, []);

  const fetchSnapshot = useCallback(async (server = baseRef.current) => {
    const nextSnapshot = await sendAt<WorldSnapshot>(server, '/admin/world/snapshot');
    if (mountedRef.current && server === baseRef.current) applySnapshot(nextSnapshot);
  }, [applySnapshot, sendAt]);

  const refreshAt = useCallback(async (server: string) => {
    const [registry] = await Promise.all([
      sendAt<{ generators?: GeneratorDefinition[] }>(server, '/admin/world/generators', { admin: true }),
      fetchSnapshot(server),
    ]);
    if (!mountedRef.current || server !== baseRef.current) return;
    const nextGenerators = registry.generators ?? [];
    setGenerators(nextGenerators);
    setSelectedGenerator(current => {
      if (nextGenerators.some(generator => generator.name === current)) return current;
      if (nextGenerators.some(generator => generator.name === 'recursive')) return 'recursive';
      return nextGenerators[0]?.name ?? '';
    });
    setStatus({ kind: 'ok', text: 'live' });
  }, [fetchSnapshot, sendAt]);

  const stopAsyncWork = useCallback(() => {
    busyRef.current = false;
    generationRef.current?.abort();
    generationRef.current = null;
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
  }, []);

  const disconnect = useCallback((sync = true) => {
    stopAsyncWork();
    baseRef.current = '';
    setBase('');
    setBusy(false);
    setStatus({ kind: '', text: 'offline' });
    if (sync) BunnylandApi.setServerInUrl('');
  }, [stopAsyncWork]);

  const openSocket = useCallback((server: string) => {
    const socket = new WebSocket(BunnylandApi.socketUrl(server));
    socketRef.current = socket;
    socket.onmessage = (event) => {
      if (server !== baseRef.current) return;
      const message = JSON.parse(String(event.data)) as SocketMessage;
      if (message.type === 'snapshot') {
        applySnapshot(message.data as unknown as WorldSnapshot);
        log('Snapshot received from live stream', 'ok');
      } else if (message.type === 'event') {
        const eventType = String(message.data?.event_type ?? 'event');
        const eventData = (message.data?.event ?? {}) as Record<string, unknown>;
        if (eventType === 'WorldGenerationStartedEvent') {
          log(`Generation job ${String(eventData.job_id)} started`, 'ok');
        } else if (eventType === 'WorldGenerationCompletedEvent') {
          log(`Generation complete: ${String(eventData.room_count)} room(s), ${String(eventData.character_count)} character(s)`, 'ok');
          void fetchSnapshot(server).catch(() => undefined);
        } else if (eventType === 'WorldGenerationFailedEvent') {
          log(`Generation failed: ${String(eventData.error)}`, 'error');
        } else {
          log(`Event: ${eventType}`);
        }
      } else if (message.type === 'patch') {
        log('World patch applied');
        void fetchSnapshot(server);
      }
    };
    socket.onopen = () => {
      if (socketRef.current === socket) setStatus({ kind: 'ok', text: 'live' });
    };
    socket.onclose = () => {
      if (socketRef.current === socket) setStatus({ kind: 'err', text: 'socket closed' });
    };
    socket.onerror = () => {
      if (socketRef.current === socket) setStatus({ kind: 'err', text: 'socket error' });
    };
  }, [applySnapshot, fetchSnapshot, log]);

  const connect = useCallback(async (url: string) => {
    disconnect(false);
    const server = BunnylandApi.normalizeBase(url);
    if (!server) return;
    baseRef.current = server;
    setBase(server);
    setStatus({ kind: '', text: 'connecting' });
    try {
      await refreshAt(server);
      if (server !== baseRef.current) return;
      openSocket(server);
      BunnylandApi.setServerInUrl(server);
      log('Connected to server', 'ok');
    } catch (error) {
      if (server !== baseRef.current) return;
      setStatus({ kind: 'err', text: `error: ${errorMessage(error)}` });
      log(`Connection error: ${errorMessage(error)}`, 'error');
    }
  }, [disconnect, log, openSocket, refreshAt]);

  useEffect(() => {
    mountedRef.current = true;
    BunnylandUI.initClientMenu();
    void BunnylandApi.applyConfigToInput({
      connect: server => { void connect(server); },
      isConnected: () => Boolean(baseRef.current),
    });
    BunnylandApi.applyServerParam({ connect: server => { void connect(server); } });
    return () => {
      mountedRef.current = false;
      stopAsyncWork();
    };
  }, [connect, stopAsyncWork]);

  const refresh = useCallback(async () => {
    if (!baseRef.current) return;
    try {
      await refreshAt(baseRef.current);
    } catch (error) {
      setStatus({ kind: 'err', text: `error: ${errorMessage(error)}` });
      log(`Refresh error: ${errorMessage(error)}`, 'error');
    }
  }, [log, refreshAt]);

  const watchGeneration = useCallback(async (jobId: string, signal: AbortSignal) => {
    while (busyRef.current && !signal.aborted) {
      await abortableDelay(1000, signal);
      const [generation] = await Promise.all([
        sendAt<GenerationStatus>(baseRef.current, '/admin/world/generation', {
          admin: true, prompt: false,
        }),
        fetchSnapshot(),
      ]);
      if (generation.job_id !== jobId) continue;
      if (generation.status === 'succeeded') {
        log(`Generated ${String(generation.rooms)} room(s), ${String(generation.characters)} character(s) at epoch ${String(generation.world_epoch)}`, 'ok');
        return;
      }
      if (generation.status === 'failed') {
        throw new Error(generation.error ?? 'world generation failed');
      }
    }
  }, [fetchSnapshot, log, sendAt]);

  const generate = useCallback(async () => {
    if (busyRef.current) return;
    const generator = generators.find(item => item.name === selectedGenerator);
    if (!selectedGenerator) {
      log('Choose a generator first', 'error');
      return;
    }
    if (!confirmReset) {
      log('Confirm reset before generating a replacement world', 'error');
      return;
    }
    const controller = new AbortController();
    generationRef.current?.abort();
    generationRef.current = controller;
    busyRef.current = true;
    setBusy(true);
    log(`Starting ${selectedGenerator} generation`, 'ok');
    try {
      const response = await sendAt<{ job_id: string; status: string }>(baseRef.current, '/admin/world/generate', {
        admin: true,
        body: JSON.stringify({
          confirm_reset: true,
          generator: selectedGenerator,
          max_rooms: Number(maxRooms) > 0 ? Number(maxRooms) : null,
          save,
          seed: generatorUsesSeed(generator) ? seed.trim() : '',
        }),
        method: 'POST',
      });
      if (controller.signal.aborted) return;
      log(`Generation job ${response.job_id} is ${response.status}`, 'ok');
      await fetchSnapshot();
      await watchGeneration(response.job_id, controller.signal);
      await fetchSnapshot();
    } catch (error) {
      if (!controller.signal.aborted) log(`Generation error: ${errorMessage(error)}`, 'error');
    } finally {
      if (generationRef.current === controller) {
        generationRef.current = null;
        busyRef.current = false;
        if (mountedRef.current) setBusy(false);
      }
    }
  }, [confirmReset, fetchSnapshot, generators, log, maxRooms, save, seed, selectedGenerator, sendAt, watchGeneration]);

  const selectedDefinition = generators.find(generator => generator.name === selectedGenerator);
  const usesSeed = generatorUsesSeed(selectedDefinition);
  const sortedEntities = useMemo<GeneratedEntityItem[]>(() => [...entities]
    .sort((a, b) => entityKind(a).localeCompare(entityKind(b)) || entityName(a).localeCompare(entityName(b)))
    .map(entity => {
      const kind = entityKind(entity);
      return {
        generated: lastAdded.has(entity.id),
        icon: kind === 'room' ? 'R' : kind === 'character' ? 'C' : 'E',
        id: entity.id,
        kind,
        name: entityName(entity),
      };
    }), [entities, lastAdded]);
  const rooms = entities.filter(entity => Boolean(entity.components?.RoomComponent)).length;
  const characters = entities.filter(entity => Boolean(entity.components?.CharacterComponent)).length;

  return <>
    <div id="toolbar">
      <div class="toolbar-row">
        <span class="toolbar-brand"><img src="favicon.png" alt="" /> Bunnyland World Generator</span>
        <span class="toolbar-sep">|</span>
        <label for="api-url">Server:</label>
        <input ref={apiInputRef} type="text" id="api-url" defaultValue="/api/" spellcheck={false} />
        <button id="btn-connect" onClick={() => base ? disconnect() : void connect(apiInputRef.current?.value.trim() ?? '')}>
          {base ? 'Disconnect' : 'Connect'}
        </button>
        <button id="btn-refresh" disabled={!base} onClick={() => { void refresh(); }}>Refresh</button>
        <span id="api-status" class={status.kind}>{status.text}</span>
        <button id="btn-client-menu" class="client-menu-button" type="button">Menu</button>
      </div>
    </div>

    <div id="main" class="app-grid">
      <section class="pane">
        <div class="pane-header">
          <div class="pane-title">Generate World</div>
          <span class="pane-count" id="generator-count">{generators.length} generator{generators.length === 1 ? '' : 's'}</span>
        </div>
        <div class="pane-body">
          <div class="control-stack">
            <div class="field-stack">
              <label for="generator-select">Generator</label>
              <select id="generator-select" disabled={generators.length === 0} value={selectedGenerator}
                onChange={event => setSelectedGenerator(event.currentTarget.value)}>
                {generators.length === 0
                  ? <option value="">{base ? 'No generators available' : 'Connect to load generators'}</option>
                  : generators.map(generator => <option value={generator.name} key={generator.name}>{generator.name}</option>)}
              </select>
              <div class="hint" id="generator-description">{selectedDefinition?.description ?? 'Available generators come from the enabled server plugins.'}</div>
            </div>

            <div class="field-stack">
              <label for="seed-input">Prompt / seed</label>
              <textarea id="seed-input" spellcheck={true} disabled={!usesSeed} value={seed}
                onInput={event => setSeed(event.currentTarget.value)} />
              <div class="hint" id="seed-hint">{usesSeed
                ? 'With LLM world generation, this steers the setting. Offline generators still record it as provenance.'
                : 'This generator is a fixed demo or reset; it ignores prompt and seed input.'}</div>
            </div>

            <div class="field-row">
              <label for="max-rooms">Rooms</label>
              <input id="max-rooms" type="number" min="1" value={maxRooms}
                onInput={event => setMaxRooms(event.currentTarget.value)} />
              <label><input id="save-world" type="checkbox" checked={save}
                onChange={event => setSave(event.currentTarget.checked)} /> save after generation</label>
            </div>

            <div class="field-stack">
              <label><input id="confirm-reset" type="checkbox" checked={confirmReset}
                onChange={event => setConfirmReset(event.currentTarget.checked)} /> clear the current world first</label>
              <div class="hint">This replaces the live ECS world and clears queued commands. Use Save when the server was started with a save path.</div>
            </div>

            <button id="btn-generate" disabled={!base || busy} onClick={() => { void generate(); }}>Generate New World</button>
          </div>
        </div>
      </section>

      <section class="pane">
        <div class="pane-header">
          <div class="pane-title">Progress</div>
          <span class="pane-count" id="world-summary">
            {entities.length === 0 && snapshot.world_epoch === undefined
              ? 'No world loaded'
              : `${snapshot.metadata?.seed ?? 'no seed'} · ${snapshot.metadata?.generator ?? 'unknown'} · epoch ${snapshot.world_epoch ?? 0}`}
          </span>
        </div>
        <div class="pane-body">
          <div class="control-stack">
            <div class="metric-grid">
              <div class="metric"><div class="metric-value" id="metric-entities">{entities.length}</div><div class="metric-label">entities</div></div>
              <div class="metric"><div class="metric-value" id="metric-rooms">{rooms}</div><div class="metric-label">rooms</div></div>
              <div class="metric"><div class="metric-value" id="metric-characters">{characters}</div><div class="metric-label">characters</div></div>
              <div class="metric"><div class="metric-value" id="metric-new">{lastAdded.size}</div><div class="metric-label">new in last snapshot</div></div>
            </div>
          </div>
          <div id="activity-list">
            {activities.length === 0
              ? <EmptyState id="empty-activity">Connect to a server to load generators and stream world updates.</EmptyState>
              : activities.map(activity => <div class={`activity-row ${activity.kind ? `kind-${activity.kind}` : ''}`} key={activity.id}>
                <div class="activity-time">{activity.time}</div><div>{activity.text}</div>
              </div>)}
          </div>
        </div>
      </section>

      <section class="pane" id="entity-pane">
        <div class="pane-header">
          <div class="pane-title">Generated Entities</div>
          <span class="pane-count" id="entity-count">{entities.length}</span>
        </div>
        <div class="pane-body"><div id="entity-list"><GeneratedEntityList entities={sortedEntities} /></div></div>
      </section>
    </div>
  </>;
}

const root = document.getElementById('app');
if (root) render(<WorldGeneratorPage />, root);
