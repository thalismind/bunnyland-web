import { render } from 'preact';
import { useCallback } from 'preact/hooks';

const ownedRoots = new WeakSet<HTMLElement>();

function own(root: HTMLElement) {
  if (ownedRoots.has(root)) return;
  root.replaceChildren();
  ownedRoots.add(root);
}

export interface TuiActivityRow {
  icon: string;
  key: string;
  kind: string;
  text: string;
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
      {row.icon && <span class="action-icon">{row.icon}</span>}{row.text}
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

export interface TuiLiveProjectionProps {
  actions: readonly TuiActionRow[];
  activity: readonly TuiActivityRow[];
  countdown: number | null;
  onAction: (index: number) => void;
  onCancel: (id: string) => void;
  queued: readonly TuiQueuedRow[];
}

export function renderActivityRows(root: HTMLElement, rows: readonly TuiActivityRow[]) {
  own(root);
  render(<ActivityRows rows={rows} />, root);
}

export function renderActionSections(
  root: HTMLElement,
  actions: readonly TuiActionRow[],
  onAction: (index: number) => void,
) {
  own(root);
  render(<ActionSections actions={actions} onAction={onAction} />, root);
}

export function renderQueuedRows(
  root: HTMLElement,
  rows: readonly TuiQueuedRow[],
  countdown: number | null,
  onCancel: (id: string) => void,
) {
  own(root);
  render(<QueuedRows countdown={countdown} onCancel={onCancel} rows={rows} />, root);
}

export function renderTuiLiveProjections(
  roots: { actions: HTMLElement; activity: HTMLElement; queued: HTMLElement },
  props: TuiLiveProjectionProps,
) {
  renderActivityRows(roots.activity, props.activity);
  renderActionSections(roots.actions, props.actions, props.onAction);
  renderQueuedRows(roots.queued, props.queued, props.countdown, props.onCancel);
}

type TuiPageWindow = Window & {
  BunnylandToolPreact?: {
    renderActionSections?: typeof renderActionSections;
    renderActivityRows?: typeof renderActivityRows;
    renderQueuedRows?: typeof renderQueuedRows;
    renderTuiLiveProjections?: typeof renderTuiLiveProjections;
  };
  app?: { render?: () => void };
};

const pageWindow = window as TuiPageWindow;
pageWindow.BunnylandToolPreact ??= {};
pageWindow.BunnylandToolPreact.renderActionSections = renderActionSections;
pageWindow.BunnylandToolPreact.renderActivityRows = renderActivityRows;
pageWindow.BunnylandToolPreact.renderQueuedRows = renderQueuedRows;
pageWindow.BunnylandToolPreact.renderTuiLiveProjections = renderTuiLiveProjections;
pageWindow.app?.render?.();
