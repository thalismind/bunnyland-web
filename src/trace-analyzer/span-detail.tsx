import { render } from 'preact';

export interface TraceDetailEntry {
  key: string;
  value: string;
}

export interface TraceDetailSection {
  entries: readonly TraceDetailEntry[];
  title: string;
}

export interface TraceSpanDetail {
  childCount: number;
  duration: string;
  kind: string;
  name: string;
  rawJson: string;
  sections: readonly TraceDetailSection[];
  service: string;
  spanId: string;
  startDate: string;
  startOffset: string;
  status: string;
  traceId: string;
}

interface SpanDetailProps {
  detail: TraceSpanDetail | null;
}

export function SpanDetail({ detail }: SpanDetailProps) {
  if (!detail) {
    return <div class="detail-empty">Select a span to inspect attributes, resources, events, and ids.</div>;
  }
  return <>
    <div class="detail-title">{detail.service}: {detail.name}</div>
    <div class="detail-meta">
      Duration: <strong>{detail.duration}</strong><br />
      Start: <strong>{detail.startOffset}</strong> ({detail.startDate})<br />
      Child count: <strong>{detail.childCount}</strong><br />
      Kind: <strong>{detail.kind}</strong><br />
      Status: <strong>{detail.status}</strong>
    </div>
    <div class="detail-actions">
      <button type="button" data-copy={detail.traceId}>Trace ID</button>
      <button type="button" data-copy={detail.spanId}>Span ID</button>
      <button type="button" data-copy={detail.rawJson}>Span JSON</button>
    </div>
    {detail.sections.map((section) => (
      <section class="detail-section" data-section={section.title} key={section.title}>
        <h2>{section.title}</h2>
        {section.entries.length > 0
          ? <table class="kv-table"><tbody>
            {section.entries.map((entry) => (
              <tr data-entry-key={entry.key} key={entry.key}>
                <th>{entry.key}</th><td>{entry.value}</td>
              </tr>
            ))}
          </tbody></table>
          : <div class="detail-empty">None.</div>}
      </section>
    ))}
  </>;
}

export function renderSpanDetail(root: HTMLElement, detail: TraceSpanDetail | null) {
  render(<SpanDetail detail={detail} />, root);
}

type TraceDetailBridge = { renderSpanDetail?: typeof renderSpanDetail };
type TraceDetailWindow = Window & { BunnylandToolPreact?: TraceDetailBridge };

const bridgeWindow = window as TraceDetailWindow;
bridgeWindow.BunnylandToolPreact ??= {};
bridgeWindow.BunnylandToolPreact.renderSpanDetail = renderSpanDetail;
