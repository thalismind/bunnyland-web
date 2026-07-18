export interface SheetMetric {
  band?: string;
  label: string;
  maximum?: number | null;
  text?: string;
  value?: number | null;
}

export interface MetricListProps {
  emptyMessage: string;
  metrics: readonly SheetMetric[];
}

export function MetricList({ emptyMessage, metrics }: MetricListProps) {
  if (metrics.length === 0) return <>{emptyMessage}</>;
  const occurrences = new Map<string, number>();
  return <>{metrics.map((metric) => {
    const maximum = Number(metric.maximum || 0);
    const value = Number(metric.value || 0);
    const percent = maximum > 0 ? Math.max(0, Math.min(100, (value / maximum) * 100)) : 0;
    const text = metric.text || (maximum > 0 ? `${value} / ${maximum}` : String(value));
    const band = String(metric.band || '').replace(/[^a-z0-9_-]/gi, '').toLowerCase();
    const occurrence = occurrences.get(metric.label) || 0;
    occurrences.set(metric.label, occurrence + 1);
    return <div class={`metric-row ${band}`} data-metric={metric.label} key={`${metric.label}:${occurrence}`}>
      <div class="metric-head">
        <span class="metric-label">{metric.label}</span>
        <span>{text}</span>
      </div>
      {maximum > 0 && <div class="meter"><div class="meter-fill" style={{ width: `${percent.toFixed(1)}%` }} /></div>}
    </div>;
  })}</>;
}
