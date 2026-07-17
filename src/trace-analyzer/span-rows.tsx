import { render } from 'preact';

export interface TraceSpanRow {
  childCount: number;
  className: string;
  depth: number;
  duration: string;
  durationClassName: string;
  durationLeft: string;
  durationWidth: string;
  id: string;
  labelLeft: string;
  name: string;
  selected: boolean;
  service: string;
}

export interface SpanRowsProps {
  rows: readonly TraceSpanRow[];
}

export function SpanRows({ rows }: SpanRowsProps) {
  if (rows.length === 0) {
    return <div class="detail-empty" style={{ padding: '12px' }}>No spans match the current filters.</div>;
  }

  return <>{rows.map((row) => (
    <div
      class={`span-row ${row.className}${row.selected ? ' selected' : ''}`}
      data-span-id={row.id}
      key={row.id}
    >
      <div class="span-label" style={{ paddingLeft: `${8 + Math.min(row.depth * 18, 180)}px` }}>
        <span class="span-service">{row.service}</span>
        <span class="span-name">{row.name}</span>
        <span class="span-count">{row.childCount || ''}</span>
      </div>
      <div class="span-timeline">
        <div
          class={`span-duration ${row.durationClassName}`}
          style={{ left: row.durationLeft, width: row.durationWidth }}
        />
        <span class="duration-label" style={{ marginLeft: row.labelLeft }}>{row.duration}</span>
      </div>
    </div>
  ))}</>;
}

export function renderSpanRows(root: HTMLElement, rows: readonly TraceSpanRow[]) {
  render(<SpanRows rows={rows} />, root);
}

type TraceBridge = {
  renderSpanRows?: typeof renderSpanRows;
};

type TracePageWindow = Window & {
  BunnylandToolPreact?: TraceBridge;
  traceAnalyzer?: { render?: () => void };
};

const pageWindow = window as TracePageWindow;
pageWindow.BunnylandToolPreact ??= {};
pageWindow.BunnylandToolPreact.renderSpanRows = renderSpanRows;
pageWindow.traceAnalyzer?.render?.();
