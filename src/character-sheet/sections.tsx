export interface OverviewContent {
  appearance?: string;
  biography?: string;
  description?: string;
  tags?: readonly string[];
}

export interface SheetRow {
  entry?: boolean;
  key: string;
  label: string;
  meta: string;
  unavailable?: boolean;
}

export interface OverviewProps {
  emptyMessage: string;
  overview: OverviewContent;
}

export interface PillListProps {
  emptyMessage: string;
  values: readonly string[];
}

export interface SheetListProps {
  emptyMessage: string;
  rows: readonly SheetRow[];
}

export function Overview({ emptyMessage, overview }: OverviewProps) {
  const tags = overview.tags || [];
  const hasContent = Boolean(overview.description || overview.appearance || overview.biography || tags.length);
  if (!hasContent) return <>{emptyMessage}</>;
  const tagOccurrences = new Map<string, number>();
  return <>
    {overview.description && <p>{overview.description}</p>}
    {overview.appearance && <p>{overview.appearance}</p>}
    {overview.biography && <p>{overview.biography}</p>}
    {tags.length > 0 && <div class="pill-row">
      {tags.map((tag) => {
        const occurrence = tagOccurrences.get(tag) || 0;
        tagOccurrences.set(tag, occurrence + 1);
        return <span class="pill" key={`${tag}:${occurrence}`}>{tag}</span>;
      })}
    </div>}
  </>;
}

export function PillList({ emptyMessage, values }: PillListProps) {
  if (values.length === 0) return <>{emptyMessage}</>;
  const occurrences = new Map<string, number>();
  return <>{values.map((value) => {
    const occurrence = occurrences.get(value) || 0;
    occurrences.set(value, occurrence + 1);
    return <span class="pill" data-pill={value} key={`${value}:${occurrence}`}>{value}</span>;
  })}</>;
}

export function SheetList({ emptyMessage, rows }: SheetListProps) {
  if (rows.length === 0) return <>{emptyMessage}</>;
  return <>{rows.map((row) => <div
    class={`sheet-row${row.entry ? ' entry' : ''}${row.unavailable ? ' unavailable' : ''}`}
    data-row-key={row.key}
    key={row.key}
  >
    <strong>{row.label}</strong><span>{row.meta}</span>
  </div>)}</>;
}
