import { moveRovingSelection } from '../roving-selection';

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
  onSelect?: (id: string) => void;
  rows: readonly TraceSpanRow[];
}

export function SpanRows({ onSelect, rows }: SpanRowsProps) {
  if (rows.length === 0) {
    return <div class="detail-empty" style={{ padding: '12px' }}>No spans match the current filters.</div>;
  }

  return <>{rows.map((row) => (
    <div
      aria-selected={row.selected}
      class={`span-row ${row.className}${row.selected ? ' selected' : ''}`}
      data-span-id={row.id}
      key={row.id}
      onClick={() => onSelect?.(row.id)}
      onKeyDown={event => moveRovingSelection(event, '[role="option"]', element => {
        const id = element.dataset.spanId;
        if (id) onSelect?.(id);
      })}
      role="option"
      tabIndex={row.selected || !rows.some(item => item.selected) && row === rows[0] ? 0 : -1}
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
