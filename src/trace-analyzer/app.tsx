import { ThemeSelect } from '@bunnyland/ui-web/preact';
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { SpanDetail, type TraceDetailEntry, type TraceSpanDetail } from './span-detail';
import { SpanRows, type TraceSpanRow } from './span-rows';

type JsonObject = Record<string, unknown>;

interface TraceEvent {
  attributes?: JsonObject;
  name?: string;
  timestamp_unix_nano?: number | string;
}

interface TraceSpan {
  attributes: JsonObject;
  children: TraceSpan[];
  depth: number;
  durationNs: number;
  events: TraceEvent[];
  kind: string;
  name: string;
  parentSpanId: string | null;
  raw: unknown;
  resource: JsonObject;
  service: string;
  spanId: string;
  startNs: number;
  status: { code: string; description: string };
}

interface Trace {
  durationNs: number;
  errorCount: number;
  flat: TraceSpan[];
  root?: TraceSpan;
  services: string[];
  spans: TraceSpan[];
  startNs: number;
  traceId: string;
}

interface TraceParseResult {
  filename: string;
  traces: Trace[];
}

interface TraceHelpers {
  filterSpans(trace: Trace, filters: { service: string; status: string; text: string }): TraceSpan[];
  formatDate(ns: number): string;
  formatDuration(ns: number): string;
  formatOffset(span: TraceSpan, trace: Trace): string;
  formatRelative(ns: number, nowMs?: number): string;
  normalizeId(value: unknown, length: number): string;
  parseTraceText(text: string, filename?: string): TraceParseResult;
  traceTitle(trace: Trace): string;
}

interface TempoSummary {
  durationNs: number;
  startNs: number;
  title: string;
  traceId: string;
}

interface TempoSearchEntry {
  durationMs?: number;
  rootServiceName?: string;
  rootTraceName?: string;
  startTimeUnixNano?: number | string;
  traceID?: string;
  traceId?: string;
}

const traceGlobals = globalThis as typeof globalThis & {
  BunnylandApi: {
    assertSameOriginBase(base: string): string;
    normalizeBase(base: string): string;
    serverFromUrl(): string;
  };
  BunnylandTrace: TraceHelpers;
};

const TEMPO = { defaultBase: '/tempo', limit: 50, lookbackSec: 3 * 60 * 60, refreshMs: 60_000 } as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatValue(value: unknown): string {
  if (value == null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 16)}...` : value;
}

function spanClass(span: TraceSpan, trace: Trace): string {
  return [span.status.code === 'ERROR' ? 'error' : '', span.spanId === trace.root?.spanId ? 'root' : '']
    .filter(Boolean).join(' ');
}

function barLeft(span: TraceSpan, trace: Trace): number {
  if (!trace.durationNs) return 0;
  return Math.min(100, Math.max(0, ((span.startNs - trace.startNs) / trace.durationNs) * 100));
}

function barWidth(span: TraceSpan, trace: Trace): number {
  if (!trace.durationNs) return 0.5;
  return Math.min(100, Math.max(0.5, (span.durationNs / trace.durationNs) * 100));
}

function statusLabel(span: TraceSpan): string {
  return [span.status.code, span.status.description].filter(Boolean).join(' - ');
}

function entries(value: JsonObject | undefined): TraceDetailEntry[] {
  return Object.entries(value ?? {}).map(([entryKey, entryValue]) => ({ key: entryKey, value: formatValue(entryValue) }));
}

function spanDetail(trace: Trace, span: TraceSpan | undefined): TraceSpanDetail | null {
  if (!span) return null;
  return {
    childCount: span.children.length,
    duration: traceGlobals.BunnylandTrace.formatDuration(span.durationNs),
    kind: span.kind || 'unset',
    name: span.name,
    rawJson: JSON.stringify(span.raw, null, 2),
    sections: [
      { entries: entries(span.attributes), title: 'Span attributes' },
      { entries: entries(span.resource), title: 'Resource attributes' },
      {
        entries: (span.events ?? []).map((event, index) => ({
          key: `${index + 1}. ${event.name || 'event'}`,
          value: `${event.timestamp_unix_nano ? traceGlobals.BunnylandTrace.formatDate(Number(event.timestamp_unix_nano)) : ''} ${JSON.stringify(event.attributes ?? {})}`,
        })),
        title: 'Events',
      },
      { entries: entries({ parent_span_id: span.parentSpanId || '', span_id: span.spanId, trace_id: trace.traceId }), title: 'IDs' },
    ],
    service: span.service,
    spanId: span.spanId,
    startDate: traceGlobals.BunnylandTrace.formatDate(span.startNs),
    startOffset: traceGlobals.BunnylandTrace.formatOffset(span, trace),
    status: statusLabel(span),
    traceId: trace.traceId,
  };
}

function promptTempoBasicAuth(): string | null {
  const username = window.prompt('Tempo username');
  if (username === null) return null;
  const password = window.prompt('Tempo password');
  return password === null ? null : `Basic ${btoa(`${username}:${password}`)}`;
}

export function TraceAnalyzerPage() {
  const initialServer = traceGlobals.BunnylandApi.serverFromUrl();
  const [fileName, setFileName] = useState('');
  const [traces, setTracesState] = useState<Trace[]>([]);
  const [selectedTraceId, setSelectedTraceIdState] = useState('');
  const [selectedSpanId, setSelectedSpanId] = useState('');
  const [filterText, setFilterText] = useState('');
  const [filterService, setFilterService] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [tempoUrl, setTempoUrl] = useState(initialServer
    ? `${traceGlobals.BunnylandApi.normalizeBase(initialServer)}/tempo` : TEMPO.defaultBase);
  const [tempoConnected, setTempoConnectedState] = useState(false);
  const [tempoSummaries, setTempoSummariesState] = useState<TempoSummary[]>([]);
  const [tempoStatus, setTempoStatus] = useState({ state: '', text: 'offline' });
  const [copiedValue, setCopiedValue] = useState('');
  const tracesRef = useRef<Trace[]>([]);
  const selectedTraceRef = useRef('');
  const tempoConnectedRef = useRef(false);
  const tempoSummariesRef = useRef<TempoSummary[]>([]);
  const tempoBaseRef = useRef('');
  const tempoAuthRef = useRef<string | null>(null);
  const tempoTimerRef = useRef<number | null>(null);
  const tempoAbortRef = useRef<AbortController | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const setTraces = (next: Trace[]) => { tracesRef.current = next; setTracesState(next); };
  const setSelectedTrace = (next: string) => { selectedTraceRef.current = next; setSelectedTraceIdState(next); };
  const setTempoConnected = (next: boolean) => { tempoConnectedRef.current = next; setTempoConnectedState(next); };
  const setTempoSummaries = (next: TempoSummary[]) => { tempoSummariesRef.current = next; setTempoSummariesState(next); };

  const stopTempo = (status = true) => {
    if (tempoTimerRef.current !== null) window.clearInterval(tempoTimerRef.current);
    tempoTimerRef.current = null;
    tempoAbortRef.current?.abort();
    tempoAbortRef.current = null;
    setTempoConnected(false);
    setTempoSummaries([]);
    if (status && mountedRef.current) setTempoStatus({ state: '', text: 'offline' });
  };

  useEffect(() => () => {
    mountedRef.current = false;
    if (tempoTimerRef.current !== null) window.clearInterval(tempoTimerRef.current);
    tempoAbortRef.current?.abort();
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  const selectedTrace = traces.find(trace => trace.traceId === selectedTraceId) ?? null;
  const selectedSpan = selectedTrace?.spans.find(span => span.spanId === selectedSpanId) ?? selectedTrace?.root;
  const filteredSpans = useMemo(() => selectedTrace
    ? traceGlobals.BunnylandTrace.filterSpans(selectedTrace, {
      service: filterService, status: filterStatus, text: filterText,
    }) : [], [filterService, filterStatus, filterText, selectedTrace]);
  const axis = selectedTrace
    ? [0, 0.25, 0.5, 0.75, 1].map(part => traceGlobals.BunnylandTrace.formatDuration(selectedTrace.durationNs * part))
    : [];
  const rowItems = useMemo<TraceSpanRow[]>(() => selectedTrace ? filteredSpans.map(span => ({
    childCount: span.children.length,
    className: spanClass(span, selectedTrace),
    depth: span.depth,
    duration: traceGlobals.BunnylandTrace.formatDuration(span.durationNs),
    durationClassName: spanClass(span, selectedTrace),
    durationLeft: `${barLeft(span, selectedTrace)}%`,
    durationWidth: `${barWidth(span, selectedTrace)}%`,
    id: span.spanId,
    labelLeft: `${Math.min(92, Math.max(0, barLeft(span, selectedTrace)))}%`,
    name: span.name,
    selected: span.spanId === selectedSpanId,
    service: span.service,
  })) : [], [filteredSpans, selectedSpanId, selectedTrace]);
  const detail = useMemo(() => selectedTrace ? spanDetail(selectedTrace, selectedSpan) : null, [selectedSpan, selectedTrace]);

  const tempoFetch = async (path: string): Promise<Response> => {
    const controller = tempoAbortRef.current;
    const url = `${traceGlobals.BunnylandApi.assertSameOriginBase(tempoBaseRef.current)}${path}`;
    const request = () => fetch(url, {
      headers: { Accept: 'application/json', ...(tempoAuthRef.current ? { Authorization: tempoAuthRef.current } : {}) },
      signal: controller?.signal ?? null,
    });
    let response = await request();
    if (response.status === 401) {
      const auth = promptTempoBasicAuth();
      if (auth) { tempoAuthRef.current = auth; response = await request(); }
    }
    if (!response.ok) throw new Error(`Tempo HTTP ${response.status}`);
    return response;
  };

  const loadLiveTrace = async (traceId: string): Promise<Trace> => {
    const response = await tempoFetch(`/api/traces/${encodeURIComponent(traceId)}`);
    const parsed = traceGlobals.BunnylandTrace.parseTraceText(await response.text(), `tempo:${shortId(traceId)}`);
    const trace = parsed.traces.find(item => item.traceId === traceId) ?? parsed.traces[0];
    if (!trace) throw new Error('Tempo returned no spans for this trace');
    if (!mountedRef.current || !tempoConnectedRef.current) throw new DOMException('Operation aborted', 'AbortError');
    setFileName(`tempo · ${tempoBaseRef.current}`);
    setTraces([trace, ...tracesRef.current.filter(item => item.traceId !== trace.traceId)]);
    return trace;
  };

  const selectTrace = async (traceId: string) => {
    setSelectedTrace(traceId);
    let trace = tracesRef.current.find(item => item.traceId === traceId);
    if (traceId && tempoConnectedRef.current && !trace) {
      setTempoStatus({ state: 'ok', text: 'loading trace...' });
      trace = await loadLiveTrace(traceId);
      if (mountedRef.current) setTempoStatus({
        state: 'ok', text: `live · ${tempoSummariesRef.current.length} traces · updated ${new Date().toLocaleTimeString()}`,
      });
    }
    if (mountedRef.current) setSelectedSpanId(trace?.root?.spanId ?? '');
  };

  const toSummary = (entry: TempoSearchEntry): TempoSummary => {
    const traceId = traceGlobals.BunnylandTrace.normalizeId(entry.traceID ?? entry.traceId, 32);
    return {
      durationNs: Number(entry.durationMs ?? 0) * 1_000_000,
      startNs: Number(entry.startTimeUnixNano ?? 0),
      title: `${entry.rootServiceName || 'unknown'}: ${entry.rootTraceName || shortId(traceId)}`,
      traceId,
    };
  };

  const refreshLive = async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const params = new URLSearchParams({
      end: String(nowSec), limit: String(TEMPO.limit), q: '{}', start: String(nowSec - TEMPO.lookbackSec),
    });
    const response = await tempoFetch(`/api/search?${params}`);
    const data = await response.json() as { traces?: TempoSearchEntry[] };
    if (!mountedRef.current || !tempoConnectedRef.current) return;
    const summaries = (data.traces ?? []).map(toSummary).filter(summary => summary.traceId)
      .sort((a, b) => b.startNs - a.startNs);
    setTempoSummaries(summaries);
    if (!selectedTraceRef.current && summaries[0]) await selectTrace(summaries[0].traceId);
    if (mountedRef.current) setTempoStatus({
      state: 'ok', text: `live · ${summaries.length} traces · updated ${new Date().toLocaleTimeString()}`,
    });
  };

  const connectTempo = async () => {
    stopTempo(false);
    tempoBaseRef.current = tempoUrl.trim() || TEMPO.defaultBase;
    tempoAbortRef.current = new AbortController();
    setTempoConnected(true);
    setTempoSummaries([]);
    setSelectedTrace('');
    setSelectedSpanId('');
    setTempoStatus({ state: 'ok', text: 'connecting...' });
    try {
      await refreshLive();
      if (!mountedRef.current || !tempoConnectedRef.current) return;
      tempoTimerRef.current = window.setInterval(() => {
        void refreshLive().catch(error => {
          if (mountedRef.current && !tempoAbortRef.current?.signal.aborted) {
            setTempoStatus({ state: 'error', text: `refresh error: ${errorMessage(error)}` });
          }
        });
      }, TEMPO.refreshMs);
    } catch (error) {
      if (tempoAbortRef.current?.signal.aborted) return;
      stopTempo(false);
      if (mountedRef.current) setTempoStatus({ state: 'error', text: `error: ${errorMessage(error)}` });
    }
  };

  const loadFile = async (file: File) => {
    stopTempo();
    try {
      const text = await file.text();
      if (!mountedRef.current) return;
      const parsed = traceGlobals.BunnylandTrace.parseTraceText(text, file.name);
      setLoadError('');
      setFileName(parsed.filename);
      setTraces(parsed.traces);
      const first = parsed.traces[0];
      setSelectedTrace(first?.traceId ?? '');
      setSelectedSpanId(first?.root?.spanId ?? '');
    } catch (error) {
      if (mountedRef.current) setLoadError(`Could not load trace: ${errorMessage(error)}`);
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      if (!mountedRef.current) return;
      setCopiedValue(value);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null;
        setCopiedValue('');
      }, 1000);
    } catch {
      // Clipboard can be unavailable in local files or non-secure contexts.
    }
  };

  const traceOptions = tempoConnected ? tempoSummaries.map(summary => {
    const loaded = traces.find(trace => trace.traceId === summary.traceId);
    return {
      label: `${summary.title} · ${traceGlobals.BunnylandTrace.formatDate(summary.startNs)} · ${traceGlobals.BunnylandTrace.formatRelative(summary.startNs, Date.now())} · ${loaded ? `${loaded.spans.length} spans` : traceGlobals.BunnylandTrace.formatDuration(summary.durationNs)}`,
      traceId: summary.traceId,
    };
  }) : traces.map(trace => ({
    label: `${shortId(trace.traceId)} · ${traceGlobals.BunnylandTrace.traceTitle(trace)} · ${traceGlobals.BunnylandTrace.formatDate(trace.startNs)} · ${traceGlobals.BunnylandTrace.formatRelative(trace.startNs, Date.now())} · ${trace.spans.length} spans`,
    traceId: trace.traceId,
  }));

  return <>
    <div id="toolbar"><div class="toolbar-row">
      <span class="toolbar-brand"><img src="favicon.png" alt="" /> Bunnyland Trace Analyzer</span>
      <span class="toolbar-sep">|</span><label for="trace-file">File:</label>
      <input id="trace-file" type="file" accept=".json,.jsonl,application/json" onChange={event => {
        const file = event.currentTarget.files?.[0]; if (file) void loadFile(file);
      }} />
      <span class="toolbar-sep">|</span><label for="trace-select">Trace:</label>
      <select id="trace-select" disabled={traceOptions.length === 0} value={selectedTraceId}
        onChange={event => { void selectTrace(event.currentTarget.value).catch(error => setLoadError(`Could not load trace: ${errorMessage(error)}`)); }}>
        {traceOptions.length ? traceOptions.map(option => <option key={option.traceId} value={option.traceId}>{option.label}</option>)
          : <option value="">{tempoConnected ? 'No traces in window' : 'No trace loaded'}</option>}
      </select>
      <span class="toolbar-sep">|</span><label for="tempo-url">Tempo:</label>
      <input id="tempo-url" type="text" placeholder="/tempo" spellcheck={false} value={tempoUrl}
        onInput={event => setTempoUrl(event.currentTarget.value)} />
      <button id="tempo-connect" type="button" onClick={() => tempoConnected ? stopTempo() : void connectTempo()}>{tempoConnected ? 'Disconnect' : 'Connect'}</button>
      <span id="tempo-status" class="stub" data-state={tempoStatus.state}>{tempoStatus.text}</span>
      <span class="push"></span><label for="theme-select">Theme:</label><ThemeSelect id="theme-select" />
    </div></div>

    <div id="main" class="app-grid">
      <section id="trace-pane" aria-label="Trace view">
        <div id="drop-zone" class={dragActive ? 'active' : ''}
          onDragEnter={event => { event.preventDefault(); setDragActive(true); }}
          onDragOver={event => { event.preventDefault(); setDragActive(true); }}
          onDragLeave={event => { event.preventDefault(); setDragActive(false); }}
          onDrop={event => {
            event.preventDefault(); setDragActive(false);
            const file = event.dataTransfer?.files?.[0]; if (file) void loadFile(file);
          }}>
          {loadError || 'Load a release regression trace artifact as JSONL or JSON. Drag a file here or use the file picker.'}
        </div>

        <section id="trace-content" class={selectedTrace ? '' : 'hidden'}>
          <div id="trace-summary">
            <div><div id="trace-title" class="trace-title">{selectedTrace ? traceGlobals.BunnylandTrace.traceTitle(selectedTrace) : 'No trace loaded'}</div>
              <div id="trace-subtitle" class="trace-subtitle">{selectedTrace ? `${traceGlobals.BunnylandTrace.formatDate(selectedTrace.startNs)} · ${fileName || 'loaded trace'} · ${selectedTrace.traceId}` : ''}</div></div>
            <div class="summary-stat"><strong id="stat-duration">{selectedTrace ? traceGlobals.BunnylandTrace.formatDuration(selectedTrace.durationNs) : '0us'}</strong><span>Duration</span></div>
            <div class="summary-stat"><strong id="stat-spans">{selectedTrace?.spans.length ?? 0}</strong><span>Spans</span></div>
            <div class="summary-stat"><strong id="stat-services">{selectedTrace?.services.length ?? 0}</strong><span>Services</span></div>
            <div class="summary-stat"><strong id="stat-errors">{selectedTrace?.errorCount ?? 0}</strong><span>Errors</span></div>
          </div>
          <div id="filters">
            <input id="filter-text" type="text" placeholder="Filter spans by service, operation, attribute, or id" spellcheck={false}
              value={filterText} onInput={event => setFilterText(event.currentTarget.value)} />
            <select id="filter-service" value={filterService} onChange={event => setFilterService(event.currentTarget.value)}>
              <option value="">All services</option>{selectedTrace?.services.map(service => <option key={service} value={service}>{service}</option>)}
            </select>
            <select id="filter-status" value={filterStatus} onChange={event => setFilterStatus(event.currentTarget.value)}>
              <option value="">All statuses</option><option value="UNSET">Unset</option><option value="OK">OK</option><option value="ERROR">Error</option>
            </select>
            <button id="clear-filters" type="button" onClick={() => { setFilterText(''); setFilterService(''); setFilterStatus(''); }}>Clear</button>
          </div>
          <div id="overview-axis" class="axis">{axis.map((label, index) => <span key={index}>{label}</span>)}</div>
          <div id="overview" aria-label="Trace overview">
            <div class="timeline-grid"><span></span><span></span><span></span><span></span></div>
            {selectedTrace && filteredSpans.slice(0, 80).map((span, index) => <div
              class={`overview-bar ${spanClass(span, selectedTrace)}`} key={span.spanId}
              title={`${span.service}: ${span.name}`} style={{
                left: `${barLeft(span, selectedTrace)}%`, top: `${8 + (index % 7) * 10}px`, width: `${barWidth(span, selectedTrace)}%`,
              }} />)}
          </div>
          <div id="span-table">
            <div class="span-header"><div>Service &amp; operation</div><div id="timeline-axis" class="axis">{axis.map((label, index) => <span key={index}>{label}</span>)}</div></div>
            <div id="span-rows" class="span-rows"><SpanRows rows={rowItems} onSelect={setSelectedSpanId} /></div>
          </div>
        </section>
      </section>
      <aside id="detail-pane" aria-label="Span details"><SpanDetail detail={detail} copiedValue={copiedValue} onCopy={value => { void copy(value); }} /></aside>
    </div>
  </>;
}

const root = document.getElementById('app');
if (root) render(<TraceAnalyzerPage />, root);
