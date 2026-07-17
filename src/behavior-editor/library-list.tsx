import { EmptyState } from '@bunnyland/ui-web/preact';
import { render } from 'preact';

interface NamedListProps {
  empty: string;
  itemClass: string;
  names: readonly string[];
}

export function NamedList({ empty, itemClass, names }: NamedListProps) {
  if (names.length === 0) {
    return itemClass === 'pill'
      ? <span class="tiny">{empty}</span>
      : <EmptyState>{empty}</EmptyState>;
  }
  if (itemClass === 'pill') {
    return <>{names.map((name) => <span class="pill" data-name={name} key={name}>{name}</span>)}</>;
  }
  return <>{names.map((name) => <div class={itemClass} data-name={name} key={name}>{name}</div>)}</>;
}

export function renderNamedList(
  root: HTMLElement,
  names: readonly string[],
  itemClass: string,
  empty: string,
) {
  render(<NamedList names={names} itemClass={itemClass} empty={empty} />, root);
}

type BehaviorLibraryBridge = { renderNamedList?: typeof renderNamedList };
type BehaviorEditorWindow = Window & {
  BunnylandBehaviorPreact?: BehaviorLibraryBridge;
  app?: { _renderLibrary?: () => void };
};

const bridgeWindow = window as BehaviorEditorWindow;
bridgeWindow.BunnylandBehaviorPreact ??= {};
bridgeWindow.BunnylandBehaviorPreact.renderNamedList = renderNamedList;
bridgeWindow.app?._renderLibrary?.();
