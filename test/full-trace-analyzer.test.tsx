import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TraceAnalyzerPage } from '../src/trace-analyzer/app';
import { expectNoSeriousAxeIssues } from './axe';

const rootSpan = {
  attributes: { release: 'test' }, children: [] as unknown[], depth: 0, durationNs: 50_000_000,
  events: [], kind: 'SERVER', name: 'release.multiclient', parentSpanId: null,
  raw: { span_id: 'aaaaaaaaaaaaaaaa' }, resource: { 'service.name': 'release-runner' },
  service: 'release-runner', spanId: 'aaaaaaaaaaaaaaaa', startNs: 1_750_000_000_000_000_000,
  status: { code: 'UNSET', description: '' },
};
const moveSpan = {
  attributes: { 'command.type': 'move' }, children: [], depth: 1, durationNs: 24_000_000,
  events: [{ attributes: { ok: false }, name: 'checked', timestamp_unix_nano: 1_750_000_000_020_000_000 }],
  kind: 'INTERNAL', name: 'move', parentSpanId: rootSpan.spanId,
  raw: { span_id: 'cccccccccccccccc' }, resource: { 'service.name': 'bunnyland-server' },
  service: 'bunnyland-server', spanId: 'cccccccccccccccc', startNs: 1_750_000_000_020_000_000,
  status: { code: 'ERROR', description: '' },
};
rootSpan.children = [moveSpan];
const trace = {
  durationNs: 50_000_000, errorCount: 1, flat: [rootSpan, moveSpan], root: rootSpan,
  services: ['bunnyland-server', 'release-runner'], spans: [rootSpan, moveSpan],
  startNs: rootSpan.startNs, traceId: '11111111111111111111111111111111',
};

const helpers = {
  filterSpans: vi.fn((value: typeof trace, filters: { service: string; status: string; text: string }) =>
    value.flat.filter(span => (!filters.service || span.service === filters.service)
      && (!filters.status || span.status.code === filters.status)
      && (!filters.text || `${span.service} ${span.name}`.toLowerCase().includes(filters.text.toLowerCase())))),
  formatDate: vi.fn(() => '2025-06-15 12:00:00'),
  formatDuration: vi.fn((ns: number) => `${ns / 1_000_000}ms`),
  formatOffset: vi.fn((span: typeof rootSpan) => span === rootSpan ? '0us' : '20ms'),
  formatRelative: vi.fn(() => '1m ago'),
  normalizeId: vi.fn((value: unknown) => String(value ?? '')),
  parseTraceText: vi.fn(() => ({ filename: 'release.jsonl', traces: [trace] })),
  traceTitle: vi.fn(() => 'release-runner: release.multiclient'),
};
const writeText = vi.fn(async () => undefined);

function fileWithText(text: () => Promise<string>) {
  const file = new File(['trace'], 'release.jsonl', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: text });
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('BunnylandApi', {
    assertSameOriginBase: (base: string) => base,
    normalizeBase: (base: string) => base.replace(/\/$/, ''),
    serverFromUrl: () => '',
  });
  vi.stubGlobal('BunnylandTrace', helpers);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('TraceAnalyzerPage', () => {
  it('loads a file, retains keyed span rows, filters, selects, and copies details', async () => {
    const clearTimeout = vi.spyOn(window, 'clearTimeout');
    const view = render(<TraceAnalyzerPage />);
    const file = fileWithText(async () => 'trace-jsonl');
    fireEvent.change(view.container.querySelector('#trace-file')!, { target: { files: [file] } });
    await waitFor(() => expect(view.container.querySelector('#trace-title')?.textContent).toBe('release-runner: release.multiclient'));
    const original = view.container.querySelector('[data-span-id="aaaaaaaaaaaaaaaa"]');
    fireEvent.click(view.container.querySelector('[data-span-id="cccccccccccccccc"]')!);
    expect(view.container.querySelector('[data-span-id="aaaaaaaaaaaaaaaa"]')).toBe(original);
    expect(view.container.querySelector('#detail-pane')?.textContent).toContain('Status: ERROR');
    fireEvent.input(view.container.querySelector('#filter-text')!, { target: { value: 'move' } });
    expect(view.container.querySelectorAll('#span-rows .span-row')).toHaveLength(1);
    fireEvent.click(view.getByText('Span ID'));
    await waitFor(() => expect(view.getByText('Copied')).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith('cccccccccccccccc');
    await expectNoSeriousAxeIssues(view.container);
    view.unmount();
    expect(clearTimeout).toHaveBeenCalled();
  });

  it('does not parse or update after an unfinished file read is unmounted', async () => {
    let resolve!: (value: string) => void;
    const pending = new Promise<string>(done => { resolve = done; });
    const view = render(<TraceAnalyzerPage />);
    fireEvent.change(view.container.querySelector('#trace-file')!, {
      target: { files: [fileWithText(() => pending)] },
    });
    view.unmount();
    resolve('late trace');
    await pending;
    await Promise.resolve();
    expect(helpers.parseTraceText).not.toHaveBeenCalled();
  });

  it('loads Tempo search and trace results, then aborts polling on unmount', async () => {
    const abort = vi.spyOn(AbortController.prototype, 'abort');
    const setInterval = vi.spyOn(window, 'setInterval');
    const clearInterval = vi.spyOn(window, 'clearInterval');
    helpers.parseTraceText.mockReturnValueOnce({ filename: 'tempo:test', traces: [trace] });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/search')) return new Response(JSON.stringify({ traces: [{
        durationMs: 50, rootServiceName: 'release-runner', rootTraceName: 'release.multiclient',
        startTimeUnixNano: trace.startNs, traceID: trace.traceId,
      }] }), { status: 200 });
      return new Response('tempo-trace', { status: 200 });
    }));
    const view = render(<TraceAnalyzerPage />);
    fireEvent.click(view.getByText('Connect'));
    await waitFor(() => expect(view.container.querySelector('#tempo-status')?.textContent).toContain('live'));
    expect(view.container.querySelector('#trace-title')?.textContent).toContain('release-runner');
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 60_000);
    view.unmount();
    expect(clearInterval).toHaveBeenCalled();
    expect(abort).toHaveBeenCalled();
  });
});
