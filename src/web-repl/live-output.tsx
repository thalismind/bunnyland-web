export type ReplLogPart =
  | { kind: 'break' }
  | { kind: 'countdown'; value: number }
  | { href: string; kind: 'link'; label: string }
  | { insert: string; kind: 'entity'; label: string }
  | { kind: 'strong'; value: string }
  | { kind: 'text'; value: string };

export interface ReplLogRow {
  id: number;
  kind: string;
  parts?: readonly ReplLogPart[];
  value?: string;
}

function LogPart({ part }: { part: ReplLogPart }) {
  if (part.kind === 'break') return <br />;
  if (part.kind === 'countdown') return <span data-next-tick-countdown>{part.value}</span>;
  if (part.kind === 'link') return <a href={part.href} target="_blank" rel="noopener">{part.label}</a>;
  if (part.kind === 'entity') return (
    <button class="entity-link" data-insert={part.insert} type="button">{part.label}</button>
  );
  if (part.kind === 'strong') return <strong>{part.value}</strong>;
  return <>{part.value}</>;
}

export function Transcript({ rows }: { rows: readonly ReplLogRow[] }) {
  return <>{rows.map((row) => (
    <div class={`log-row ${row.kind}`.trim()} data-log-id={row.id} key={row.id}>
      {row.parts ? row.parts.map((part, index) => <LogPart key={`${part.kind}:${index}`} part={part} />) : row.value}
    </div>
  ))}</>;
}

export function CompletionOptions({ values }: { values: readonly string[] }) {
  return <>{values.map((value) => <option key={value} value={value} />)}</>;
}
