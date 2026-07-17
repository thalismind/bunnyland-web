import { render } from 'preact';

export interface ReplActionRow {
  available: boolean;
  icon: string;
  key: string;
  label: string;
  meta: string;
  reason: string;
}

export interface ReplTargetRow {
  key: string;
  kind: string;
  label: string;
}

export interface ReplContextListsProps {
  actions: readonly ReplActionRow[];
  targets: readonly ReplTargetRow[];
}

export function ActionRows({ actions }: Pick<ReplContextListsProps, 'actions'>) {
  if (actions.length === 0) return <div class="side-empty">Pick a player to load available actions.</div>;
  return <>{actions.map((action) => (
    <div
      class={`side-row${action.available ? '' : ' unavailable'}`}
      data-action-key={action.key}
      key={action.key}
      title={action.reason}
    >
      <strong>{action.icon && <span class="action-icon">{action.icon}</span>}{action.label}</strong>
      <span class={action.reason ? 'reason' : undefined}>{action.meta}</span>
    </div>
  ))}</>;
}

export function TargetRows({ targets }: Pick<ReplContextListsProps, 'targets'>) {
  if (targets.length === 0) return <div class="side-empty">Visible target names appear here.</div>;
  return <>{targets.map((target) => (
    <div class="side-row" data-target-key={target.key} key={target.key}>
      <strong>{target.label}</strong><span>{target.kind}</span>
    </div>
  ))}</>;
}

export function renderContextLists(
  roots: { actions: HTMLElement; targets: HTMLElement },
  props: ReplContextListsProps,
) {
  render(<ActionRows actions={props.actions} />, roots.actions);
  render(<TargetRows targets={props.targets} />, roots.targets);
}

type ReplPageWindow = Window & {
  BunnylandToolPreact?: { renderContextLists?: typeof renderContextLists };
  app?: { render?: () => void };
};

const pageWindow = window as ReplPageWindow;
pageWindow.BunnylandToolPreact ??= {};
pageWindow.BunnylandToolPreact.renderContextLists = renderContextLists;
pageWindow.app?.render?.();
