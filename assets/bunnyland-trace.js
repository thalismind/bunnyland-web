(function () {
  'use strict';

  const NS_PER_MS = 1_000_000;

  function parseTraceText(text, filename = '') {
    const trimmed = String(text || '').trim();
    if (!trimmed) return { filename, spans: [], traces: [] };
    const raw = parseRawSpans(trimmed);
    const spans = raw.map(normalizeSpan).filter(span => span.traceId && span.spanId);
    const traces = buildTraces(spans);
    return { filename, spans, traces };
  }

  function parseRawSpans(text) {
    const first = text.trimStart()[0];
    if (first === '[' || first === '{') {
      try {
        const parsed = JSON.parse(text);
        return spansFromJson(parsed);
      } catch (err) {
        if (first === '[') throw err;
      }
    }
    return text.split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line));
  }

  function spansFromJson(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value.spans)) return value.spans;
    if (value.trace_id || value.traceId) return [value];
    if (Array.isArray(value.resourceSpans)) return spansFromResourceSpans(value.resourceSpans);
    // Tempo's GET /api/traces/{id} returns OTLP JSON with a `batches` array (and the v2
    // route wraps it in a `trace` object); both carry the same ResourceSpans shape.
    if (Array.isArray(value.batches)) return spansFromResourceSpans(value.batches);
    if (value.trace && typeof value.trace === 'object') return spansFromJson(value.trace);
    return [];
  }

  function spansFromResourceSpans(resourceSpans) {
    const spans = [];
    for (const resourceSpan of resourceSpans || []) {
      const resource = attributesToObject(resourceSpan.resource?.attributes || []);
      for (const scopeSpan of resourceSpan.scopeSpans || resourceSpan.instrumentationLibrarySpans || []) {
        for (const span of scopeSpan.spans || []) {
          spans.push({
            ...span,
            trace_id: span.traceId,
            span_id: span.spanId,
            parent_span_id: span.parentSpanId || null,
            start_time_unix_nano: span.startTimeUnixNano,
            end_time_unix_nano: span.endTimeUnixNano,
            attributes: attributesToObject(span.attributes || []),
            resource,
            events: (span.events || []).map(event => ({
              name: event.name,
              timestamp_unix_nano: event.timeUnixNano,
              attributes: attributesToObject(event.attributes || []),
            })),
          });
        }
      }
    }
    return spans;
  }

  function attributesToObject(attributes) {
    const out = {};
    for (const attr of attributes || []) {
      if (!attr || typeof attr !== 'object' || !attr.key) continue;
      out[attr.key] = otelValue(attr.value);
    }
    return out;
  }

  function otelValue(value) {
    if (!value || typeof value !== 'object') return value;
    if ('stringValue' in value) return value.stringValue;
    if ('intValue' in value) return Number(value.intValue);
    if ('doubleValue' in value) return Number(value.doubleValue);
    if ('boolValue' in value) return Boolean(value.boolValue);
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(otelValue);
    if ('kvlistValue' in value) return attributesToObject(value.kvlistValue.values || []);
    return value;
  }

  function normalizeSpan(span) {
    const attributes = plainObject(span.attributes);
    const resource = plainObject(span.resource);
    const startNs = toNumber(span.start_time_unix_nano ?? span.startTimeUnixNano);
    const endNs = toNumber(span.end_time_unix_nano ?? span.endTimeUnixNano);
    const traceId = String(span.trace_id || span.traceId || '').trim();
    const spanId = String(span.span_id || span.spanId || '').trim();
    const parentSpanId = String(span.parent_span_id || span.parentSpanId || '').trim() || null;
    return {
      raw: span,
      name: String(span.name || span.operation || 'span'),
      traceId,
      spanId,
      parentSpanId,
      startNs,
      endNs,
      durationNs: Math.max(0, endNs - startNs),
      attributes,
      resource,
      events: Array.isArray(span.events) ? span.events : [],
      service: String(resource['service.name'] || attributes['service.name'] || 'unknown'),
      kind: String(span.kind || attributes['span.kind'] || ''),
      status: normalizeStatus(span.status),
      children: [],
      depth: 0,
    };
  }

  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
  }

  function toNumber(value) {
    if (value == null || value === '') return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeStatus(status) {
    if (!status || typeof status !== 'object') return { code: 'UNSET', description: '' };
    return {
      code: normalizeStatusCode(status.code ?? status.status_code),
      description: String(status.description || status.message || ''),
    };
  }

  function normalizeStatusCode(code) {
    if (code == null || code === '') return 'UNSET';
    // OTLP JSON from Tempo uses numeric (0/1/2) or "STATUS_CODE_ERROR"; artifact JSONL
    // uses "StatusCode.ERROR". Normalize all of them to UNSET/OK/ERROR.
    if (typeof code === 'number') return ['UNSET', 'OK', 'ERROR'][code] || 'UNSET';
    const token = String(code).split('.').pop().replace(/^STATUS_CODE_/, '');
    return token || 'UNSET';
  }

  function buildTraces(spans) {
    const groups = new Map();
    for (const span of spans) {
      if (!groups.has(span.traceId)) groups.set(span.traceId, []);
      groups.get(span.traceId).push(span);
    }
    return [...groups.entries()]
      .map(([traceId, group]) => buildTrace(traceId, group))
      .sort((a, b) => b.startNs - a.startNs);
  }

  function buildTrace(traceId, group) {
    const spans = group.map(span => ({ ...span, children: [], depth: 0 }));
    spans.sort((a, b) => a.startNs - b.startNs || b.durationNs - a.durationNs);
    const byId = new Map(spans.map(span => [span.spanId, span]));
    const roots = [];
    for (const span of spans) {
      const parent = span.parentSpanId ? byId.get(span.parentSpanId) : null;
      if (parent) parent.children.push(span);
      else roots.push(span);
    }
    for (const root of roots) assignDepth(root, 0);
    const flat = flattenRoots(roots);
    const startNs = Math.min(...spans.map(span => span.startNs).filter(Boolean));
    const endNs = Math.max(...spans.map(span => span.endNs).filter(Boolean));
    const durationNs = Math.max(0, endNs - startNs);
    const root = roots.slice().sort((a, b) => b.durationNs - a.durationNs)[0] || spans[0];
    return {
      traceId,
      spans,
      roots,
      flat,
      root,
      startNs,
      endNs,
      durationNs,
      services: [...new Set(spans.map(span => span.service))].sort(),
      errorCount: spans.filter(span => span.status.code === 'ERROR').length,
    };
  }

  function assignDepth(span, depth) {
    span.depth = depth;
    span.children.sort((a, b) => a.startNs - b.startNs || b.durationNs - a.durationNs);
    for (const child of span.children) assignDepth(child, depth + 1);
  }

  function flattenRoots(roots) {
    const out = [];
    const visit = (span) => {
      out.push(span);
      for (const child of span.children) visit(child);
    };
    for (const root of roots) visit(root);
    return out;
  }

  function filterSpans(trace, { text = '', service = '', status = '' } = {}) {
    if (!trace) return [];
    const q = text.trim().toLowerCase();
    return trace.flat.filter(span => {
      if (service && span.service !== service) return false;
      if (status && span.status.code !== status) return false;
      if (!q) return true;
      const haystack = [
        span.name,
        span.service,
        span.spanId,
        span.parentSpanId || '',
        ...Object.keys(span.attributes),
        ...Object.values(span.attributes).map(String),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }

  function formatDuration(ns) {
    if (!Number.isFinite(ns) || ns <= 0) return '0us';
    const us = ns / 1_000;
    if (us < 1000) return `${trimNumber(us)}us`;
    const ms = ns / NS_PER_MS;
    if (ms < 1000) return `${trimNumber(ms)}ms`;
    return `${trimNumber(ms / 1000)}s`;
  }

  function formatOffset(span, trace) {
    return formatDuration(Math.max(0, span.startNs - trace.startNs));
  }

  function formatDate(ns) {
    if (!ns) return 'unknown start';
    return new Date(ns / 1_000_000).toISOString().replace('T', ' ').replace('Z', '');
  }

  function formatRelative(ns, nowMs = Date.now()) {
    if (!ns) return 'unknown';
    const deltaMs = nowMs - ns / 1_000_000;
    if (deltaMs < 1000) return 'just now';
    const seconds = deltaMs / 1000;
    if (seconds < 60) return `${Math.round(seconds)}s ago`;
    const minutes = seconds / 60;
    if (minutes < 60) return `${Math.round(minutes)}m ago`;
    const hours = minutes / 60;
    if (hours < 24) return `${Math.round(hours)}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  function trimNumber(value) {
    if (value >= 100) return value.toFixed(0);
    if (value >= 10) return value.toFixed(1).replace(/\.0$/, '');
    return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function traceTitle(trace) {
    if (!trace) return 'No trace loaded';
    return `${trace.root?.service || 'unknown'}: ${trace.root?.name || 'trace'}`;
  }

  window.BunnylandTrace = {
    filterSpans,
    formatDate,
    formatDuration,
    formatOffset,
    formatRelative,
    parseTraceText,
    traceTitle,
  };
}());
