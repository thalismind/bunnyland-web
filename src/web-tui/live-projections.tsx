import { useCallback, useRef, useState } from 'preact/hooks';

import { useSecondBoundaryTick } from '../use-second-boundary-tick';

export interface TuiActivityRow {
  icon: string;
  key: string;
  kind: string;
  media?: TuiActivityMedia;
  text: string;
}

export interface TuiActivityMedia {
  kind: 'image' | 'video';
  url: string;
}

export interface TuiActionRow {
  actionCost: number;
  available: boolean;
  focusCost: number;
  icon: string;
  index: number;
  key: string;
  lane: 'focus' | 'world';
  ready: boolean;
  reason: string;
  target: boolean;
  title: string;
}

export interface TuiQueuedRow {
  id: string;
  label: string;
}

export function ActivityRows({ rows }: { rows: readonly TuiActivityRow[] }) {
  if (rows.length === 0) return <div class="empty">No recent activity.</div>;
  return <>{rows.map((row) => (
    <div class={`activity-row${row.kind ? ` kind-${row.kind}` : ''}`} data-activity-key={row.key} key={row.key}>
      <div class="activity-row-copy">{row.icon && <span class="action-icon">{row.icon}</span>}{row.text}</div>
      {row.media && <div class={`activity-media activity-media-${row.media.kind}`}>
        {row.media.kind === 'image'
          ? <a aria-label="Open generated image" class="activity-media-link" href={row.media.url} rel="noopener noreferrer" target="_blank">
            <img alt="Generated scene" loading="lazy" src={row.media.url} /><span>Open image ↗</span>
          </a>
          : <><video controls preload="metadata" src={row.media.url}>
            <a href={row.media.url}>Open generated video</a>
          </video><a class="activity-media-open" href={row.media.url} rel="noopener noreferrer" target="_blank">Open video ↗</a></>}
      </div>}
    </div>
  ))}</>;
}

function ActionRow({ action, onAction }: { action: TuiActionRow; onAction: (index: number) => void }) {
  const select = useCallback(() => onAction(action.index), [action.index, onAction]);
  const title = action.reason || `Perform: ${action.title}`;
  return <button
    class={`option${action.available ? '' : ' unavailable'}`}
    data-action-index={action.ready ? action.index : undefined}
    data-action-key={action.key}
    key={action.key}
    onClick={action.ready ? select : undefined}
    title={title}
    type="button"
  >
    <span class="option-main">{action.icon && <span class="action-icon">{action.icon}</span>}{action.title}</span>
    <span class="verb-cost">
      {action.target && <span class="target-mark">⌖ target</span>}
      {action.actionCost > 0 && <span class="cost ap">{action.actionCost} AP</span>}
      {action.focusCost > 0 && <span class="cost fp">{action.focusCost} FP</span>}
      {action.actionCost === 0 && action.focusCost === 0 && <span class="cost free">free</span>}
      {action.reason && <span class="unavailable-reason">{action.reason}</span>}
    </span>
  </button>;
}

export function ActionSections({ actions, onAction }: {
  actions: readonly TuiActionRow[];
  onAction: (index: number) => void;
}) {
  return <>{([
    ['World actions', 'world'],
    ['Focus actions', 'focus'],
  ] as const).map(([title, lane]) => {
    const rows = actions.filter((action) => action.lane === lane);
    return <div data-action-lane={lane} key={lane}>
      <div class="action-section-title">{title}</div>
      <div class="verb-list">
        {rows.length > 0
          ? rows.map((action) => <ActionRow action={action} key={action.key} onAction={onAction} />)
          : <div class="empty">No matching actions.</div>}
      </div>
    </div>;
  })}</>;
}

export function QueuedRows({ countdown, onCancel, rows }: {
  countdown: number | null;
  onCancel: (id: string) => void;
  rows: readonly TuiQueuedRow[];
}) {
  const cancel = useCallback((event: MouseEvent) => {
    const id = (event.currentTarget as HTMLElement).dataset.cancelCommand;
    if (id) onCancel(id);
  }, [onCancel]);
  return <>
    <div id="queued-title" class="action-section-title">
      Queued actions{countdown == null ? '' : ` · next tick in ${countdown}s`}
    </div>
    {rows.length > 0 ? rows.map((row) => (
      <button
        class="option"
        data-cancel-command={row.id}
        key={row.id}
        onClick={cancel}
        title="Cancel queued action"
        type="button"
      >
        <span class="option-main">{row.label}</span><span class="option-meta">cancel</span>
      </button>
    )) : <div class="empty">No queued actions.</div>}
  </>;
}

export function LiveQueuedRows({ countdownFor, onCancel, rows, source }: {
  countdownFor: () => number | null;
  onCancel: (id: string) => void;
  rows: readonly TuiQueuedRow[];
  source: unknown;
}) {
  const countdownForRef = useRef(countdownFor);
  countdownForRef.current = countdownFor;
  const [countdown, setCountdown] = useState(() => countdownFor());
  useSecondBoundaryTick(() => setCountdown(countdownForRef.current()), source);
  return <QueuedRows countdown={countdown} onCancel={onCancel} rows={rows} />;
}

export interface TuiLiveProjectionProps {
  actions: readonly TuiActionRow[];
  activity: readonly TuiActivityRow[];
  countdown: number | null;
  onAction: (index: number) => void;
  onCancel: (id: string) => void;
  queued: readonly TuiQueuedRow[];
}
