import { render } from 'preact';

const ownedRoots = new WeakSet<HTMLElement>();

function own(root: HTMLElement) {
  if (ownedRoots.has(root)) return;
  root.replaceChildren();
  ownedRoots.add(root);
}

export interface ReplLogRow {
  html: boolean;
  id: number;
  kind: string;
  value: string;
}

export function Transcript({ rows }: { rows: readonly ReplLogRow[] }) {
  return <>{rows.map((row) => row.html
    ? <div
        class={`log-row ${row.kind}`.trim()}
        dangerouslySetInnerHTML={{ __html: row.value }}
        data-log-id={row.id}
        key={row.id}
      />
    : <div class={`log-row ${row.kind}`.trim()} data-log-id={row.id} key={row.id}>{row.value}</div>
  )}</>;
}

export function CompletionOptions({ values }: { values: readonly string[] }) {
  return <>{values.map((value) => <option key={value} value={value} />)}</>;
}

export function renderTranscript(root: HTMLElement, rows: readonly ReplLogRow[]) {
  own(root);
  render(<Transcript rows={rows} />, root);
}

export function renderCompletionOptions(root: HTMLElement, values: readonly string[]) {
  own(root);
  render(<CompletionOptions values={values} />, root);
}

type ReplPageWindow = Window & {
  BunnylandToolPreact?: {
    renderCompletionOptions?: typeof renderCompletionOptions;
    renderTranscript?: typeof renderTranscript;
  };
  app?: { _renderTranscript?: () => void; _updateCompletions?: () => void };
};

const pageWindow = window as ReplPageWindow;
pageWindow.BunnylandToolPreact ??= {};
pageWindow.BunnylandToolPreact.renderCompletionOptions = renderCompletionOptions;
pageWindow.BunnylandToolPreact.renderTranscript = renderTranscript;
pageWindow.app?._renderTranscript?.();
pageWindow.app?._updateCompletions?.();
