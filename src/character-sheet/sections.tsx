import { render } from 'preact';

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

interface OverviewProps {
  emptyMessage: string;
  overview: OverviewContent;
}

interface PillListProps {
  emptyMessage: string;
  values: readonly string[];
}

interface SheetListProps {
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

export function renderOverview(root: HTMLElement, props: OverviewProps) {
  const tags = props.overview.tags || [];
  const hasContent = Boolean(
    props.overview.description || props.overview.appearance || props.overview.biography || tags.length,
  );
  root.className = hasContent ? 'prose' : 'sheet-empty';
  render(<Overview {...props} />, root);
}

export function renderPillList(root: HTMLElement, props: PillListProps) {
  root.className = props.values.length || !props.emptyMessage ? 'pill-row' : 'sheet-empty';
  render(<PillList {...props} />, root);
}

export function renderSheetList(root: HTMLElement, props: SheetListProps) {
  root.className = props.rows.length ? 'sheet-list' : 'sheet-empty';
  render(<SheetList {...props} />, root);
}

interface CharacterSheetSectionsWindow {
  BunnylandPreact?: {
    renderOverview?: typeof renderOverview;
    renderPillList?: typeof renderPillList;
    renderSheetList?: typeof renderSheetList;
  };
  app?: { render?: () => void };
}

const bridgeWindow = window as unknown as CharacterSheetSectionsWindow;
bridgeWindow.BunnylandPreact ??= {};
bridgeWindow.BunnylandPreact.renderOverview = renderOverview;
bridgeWindow.BunnylandPreact.renderPillList = renderPillList;
bridgeWindow.BunnylandPreact.renderSheetList = renderSheetList;
bridgeWindow.app?.render?.();
