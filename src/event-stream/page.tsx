import { serverFromUrl } from '@bunnyland/ui-web/api';
import { AuthGate, AuthProvider, Button, EmptyState } from '@bunnyland/ui-web/preact';
import { render } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { EventList, type EventRecord } from './event-list';

type JsonObject = Record<string, unknown>;

export interface StreamEvent {
  [key: string]: unknown;
  event?: JsonObject;
  event_type?: string;
}

interface EventMessage extends StreamEvent {
  data?: StreamEvent;
}

interface EventApi {
  applyConfigToInput: (options: {
    connect: (server: string) => void;
    isConnected: () => boolean;
  }) => Promise<unknown>;
  applyServerParam: (options: { connect: (server: string) => void }) => string;
  normalizeBase: (base: string) => string;
  sendAdmin: (base: string, path: string, options: { getAuth: () => string | null }) => Promise<JsonObject>;
  setServerInUrl: (base: string) => void;
}

interface EventHelpers {
  ROUTINE_EVENT_TYPES: ReadonlySet<string>;
  eventSummary: (type: string, event: JsonObject, nameFor: (id: unknown) => string) => string;
  icon: (type: string) => string;
  involvedIds: (data: StreamEvent) => string[];
}

interface EventWorld {
  entityDisplayName: (entity: unknown, options: { maxFallback: number }) => string;
  parseApiSnapshot: (snapshot: JsonObject) => { entities?: Record<string, unknown> };
}

interface EventUi {
  initClientMenu: () => unknown;
}

export interface EventStreamRuntime {
  api: EventApi;
  events: EventHelpers;
  ui: EventUi;
  world: EventWorld;
}

export interface EventStreamPageProps {
  runtime: EventStreamRuntime;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function eventBody(data: StreamEvent): JsonObject {
  return data.event || {};
}

function eventId(data: StreamEvent): string {
  const id = eventBody(data).event_id;
  return typeof id === 'string' ? id : JSON.stringify(data);
}

export function appendMessages(current: readonly StreamEvent[], messages: readonly EventMessage[]): StreamEvent[] {
  const ids = new Set(current.map(eventId));
  const next = [...current];
  for (const message of messages) {
    const data = message.data || message;
    const id = eventId(data);
    if (ids.has(id)) continue;
    ids.add(id);
    next.push(data);
  }
  return next.length > 500 ? next.slice(-500) : next;
}

export function EventStreamPage({ runtime }: EventStreamPageProps) {
  const [apiUrl, setApiUrl] = useState('/api/v1/');
  const [base, setBase] = useState('');
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [entityNames, setEntityNames] = useState<Map<string, string>>(() => new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState('offline');
  const [live, setLive] = useState(true);
  const [pollInterval, setPollInterval] = useState(5);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [hideRoutine, setHideRoutine] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const baseRef = useRef('');
  const eventRef = useRef<StreamEvent[]>([]);
  const authRef = useRef<string | null>(null);
  const pollingRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  const nameFor = useCallback((id: unknown): string => {
    if (!id) return '';
    const value = String(id);
    return entityNames.get(value) || value.slice(0, 18);
  }, [entityNames]);

  const append = useCallback((messages: readonly EventMessage[]): number => {
    const list = listRef.current;
    followRef.current = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    const next = appendMessages(eventRef.current, messages);
    eventRef.current = next;
    setEvents(next);
    return next.length;
  }, []);

  const refreshFrom = useCallback(async (server: string): Promise<void> => {
    if (!server) return;
    try {
      const data = await runtime.api.sendAdmin(server, '/admin/world/events', {
        getAuth: () => authRef.current,
      });
      const messages = Array.isArray(data.events) ? data.events as EventMessage[] : [];
      setStatus(`connected · ${append(messages)} buffered`);
    } catch (error) {
      setStatus(`error: ${errorMessage(error)}`);
    }
  }, [append, runtime]);

  const loadEntityNamesFrom = useCallback(async (server: string): Promise<void> => {
    if (!server) return;
    try {
      const snapshot = await runtime.api.sendAdmin(server, '/admin/world/snapshot', {
        getAuth: () => authRef.current,
      });
      const world = runtime.world.parseApiSnapshot(snapshot);
      setEntityNames(new Map(Object.entries(world.entities || {}).map(([id, entity]) => [
        id,
        runtime.world.entityDisplayName(entity, { maxFallback: 32 }),
      ])));
    } catch (error) {
      setStatus(`names unavailable: ${errorMessage(error)}`);
    }
  }, [runtime]);

  const disconnect = useCallback((preserveUrl = false): void => {
    baseRef.current = '';
    setBase('');
    setStatus('offline');
    if (!preserveUrl) runtime.api.setServerInUrl('');
  }, [runtime]);

  const connect = useCallback(async (candidate: string): Promise<void> => {
    const normalized = runtime.api.normalizeBase(candidate);
    if (!normalized) return;
    disconnect(true);
    baseRef.current = normalized;
    setBase(normalized);
    setApiUrl(normalized);
    setStatus('Connecting...');
    runtime.api.setServerInUrl(normalized);
    await Promise.allSettled([loadEntityNamesFrom(normalized), refreshFrom(normalized)]);
  }, [disconnect, loadEntityNamesFrom, refreshFrom, runtime]);

  useEffect(() => {
    runtime.ui.initClientMenu();
    const connectTo = (server: string): void => { void connect(server); };
    void runtime.api.applyConfigToInput({
      connect: connectTo,
      isConnected: () => Boolean(baseRef.current),
    }).then((config) => {
      if (baseRef.current || !config || typeof config !== 'object') return;
      const serverUrl = (config as { serverUrl?: unknown }).serverUrl;
      if (typeof serverUrl === 'string' && serverUrl) setApiUrl(serverUrl);
    });
    runtime.api.applyServerParam({ connect: connectTo });
  }, [connect, runtime]);

  useEffect(() => {
    if (!base || !live) return;
    const timer = window.setInterval(() => {
      if (pollingRef.current || !baseRef.current) return;
      pollingRef.current = true;
      void refreshFrom(baseRef.current).finally(() => { pollingRef.current = false; });
    }, Math.max(1, pollInterval) * 1000);
    return () => window.clearInterval(timer);
  }, [base, live, pollInterval, refreshFrom]);

  const types = useMemo(
    () => [...new Set(events.map(data => data.event_type || 'Event'))].sort(),
    [events],
  );

  useEffect(() => {
    if (typeFilter && !types.includes(typeFilter)) setTypeFilter('');
  }, [typeFilter, types]);

  const filteredEvents = useMemo(() => events.filter((data) => {
    const type = data.event_type || 'Event';
    if (typeFilter && type !== typeFilter) return false;
    if (hideRoutine && runtime.events.ROUTINE_EVENT_TYPES.has(type)) return false;
    if (!search.trim()) return true;
    const body = eventBody(data);
    const text = [
      type,
      nameFor(body.actor_id),
      runtime.events.eventSummary(type, body, nameFor),
      ...runtime.events.involvedIds(data).map(id => `${id} ${nameFor(id)}`),
      JSON.stringify(data),
    ].join(' ').toLowerCase();
    return text.includes(search.trim().toLowerCase());
  }), [events, hideRoutine, nameFor, runtime, search, typeFilter]);

  const records = useMemo<EventRecord[]>(() => filteredEvents.map((data) => {
    const type = data.event_type || 'Event';
    const body = eventBody(data);
    const id = eventId(data);
    return {
      actor: body.actor_id ? nameFor(body.actor_id) : 'system',
      epoch: String(body.world_epoch ?? '-'),
      eventId: id,
      icon: runtime.events.icon(type),
      involved: runtime.events.involvedIds(data).map(entityId => ({ id: entityId, name: nameFor(entityId) })),
      json: JSON.stringify(data, null, 2),
      open: expanded.has(id),
      summary: runtime.events.eventSummary(type, body, nameFor),
      type,
      visibility: typeof body.visibility === 'string' ? body.visibility : '',
    };
  }), [expanded, filteredEvents, nameFor, runtime]);

  useLayoutEffect(() => {
    if (autoScroll && followRef.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [autoScroll, records]);

  const latestEpoch = events.length
    ? String(Math.max(...events.map(item => Number(eventBody(item).world_epoch) || 0)))
    : '-';
  const streamState = !base ? 'Disconnected' : live ? `Live · ${Math.max(1, pollInterval)}s` : 'Connected';

  return <>
    <div id="toolbar">
      <div class="toolbar-row">
        <span class="toolbar-brand"><img src="favicon.png" alt="" /> Bunnyland Event Stream</span>
        <span class="toolbar-sep">|</span>
        <label for="api-url">Server:</label>
        <input id="api-url" type="text" value={apiUrl} spellcheck={false} onInput={event => setApiUrl(event.currentTarget.value)} />
        <Button id="btn-connect" onClick={(): void => base ? disconnect() : void connect(apiUrl.trim())}>{base ? 'Disconnect' : 'Connect'}</Button>
        <Button id="btn-refresh" disabled={!base} onClick={(): void => { void refreshFrom(base); }}>Refresh</Button>
        <label class="control-row" for="live-toggle"><input id="live-toggle" type="checkbox" checked={live} onChange={event => setLive(event.currentTarget.checked)} /> live</label>
        <label for="poll-interval">Poll</label>
        <input id="poll-interval" type="number" min="1" max="60" step="1" value={pollInterval} onChange={event => setPollInterval(Math.max(1, Number(event.currentTarget.value) || 5))} />
        <span id="api-status">{status}</span>
        <Button id="btn-client-menu" class="client-menu-button">Menu</Button>
      </div>
    </div>

    <div id="main" class="app-grid">
      <section class="pane" id="controls-pane">
        <div class="pane-header">
          <div class="pane-title">Filters</div>
          <span class="pane-count" id="visible-count">{records.length}</span>
        </div>
        <div class="pane-body">
          <div class="control-stack">
            <input id="event-search" type="search" value={search} placeholder="Search event type, actor, entity, text, or JSON" spellcheck={false} onInput={event => setSearch(event.currentTarget.value)} />
            <select id="event-type-filter" value={typeFilter} onChange={event => setTypeFilter(event.currentTarget.value)}>
              <option value="">All event types</option>
              {types.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
            <label class="control-row" for="hide-routine">
              <input id="hide-routine" type="checkbox" checked={hideRoutine} onChange={event => setHideRoutine(event.currentTarget.checked)} />
              Hide routine perception and clock events
            </label>
            <label class="control-row" for="auto-scroll">
              <input id="auto-scroll" type="checkbox" checked={autoScroll} onChange={event => setAutoScroll(event.currentTarget.checked)} />
              Follow newest events
            </label>
            <Button id="btn-load-names" disabled={!base} onClick={(): void => { void loadEntityNamesFrom(base); }}>Reload Entity Names</Button>
            <Button id="btn-clear" disabled={!base} onClick={(): void => {
              eventRef.current = [];
              setEvents([]);
              setExpanded(new Set());
            }}>Clear Buffer</Button>
          </div>
          <div class="metric-grid">
            <div class="metric"><strong id="total-events">{events.length}</strong><span>Buffered</span></div>
            <div class="metric"><strong id="event-types">{types.length}</strong><span>Types</span></div>
            <div class="metric"><strong id="latest-epoch">{latestEpoch}</strong><span>Latest Epoch</span></div>
            <div class="metric"><strong id="name-count">{entityNames.size}</strong><span>Names</span></div>
          </div>
        </div>
      </section>

      <section class="pane" id="events-pane">
        <div class="pane-header">
          <div class="pane-title">Events</div>
          <span class="pane-count" id="stream-state">{streamState}</span>
        </div>
        <div id="event-list" ref={listRef}>
          {!base && events.length === 0
            ? <EmptyState>Connect to a live server to load recent events.</EmptyState>
            : <EventList events={records} onToggle={(id, open): void => setExpanded(current => {
              if (current.has(id) === open) return current;
              const next = new Set(current);
              if (open) next.add(id);
              else next.delete(id);
              return next;
            })} />}
        </div>
      </section>
    </div>
  </>;
}

interface BrowserWindow extends Window {
  BunnylandApi: EventApi;
  BunnylandEvents: EventHelpers;
  BunnylandUI: EventUi;
  BunnylandWorld: EventWorld;
}

const root = document.getElementById('app');
if (root) {
  const browserWindow = window as unknown as BrowserWindow;
  render(
    <AuthProvider base={serverFromUrl() || '/api/v1'}>
      <AuthGate scopes={['world:admin']}>
        <EventStreamPage runtime={{
          api: browserWindow.BunnylandApi,
          events: browserWindow.BunnylandEvents,
          ui: browserWindow.BunnylandUI,
          world: browserWindow.BunnylandWorld,
        }} />
      </AuthGate>
    </AuthProvider>,
    root,
  );
}
