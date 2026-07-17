import { render } from 'preact';
import { useCallback } from 'preact/hooks';

export interface TuiMember {
  icon: string;
  id: string;
  isPlayer: boolean;
  kind: string;
  label: string;
  selected: boolean;
}

export interface TuiExit {
  index: number;
  key: string;
  label: string;
  locked: boolean;
}

export interface TuiInventoryItem {
  icon: string;
  id: string;
  kind: string;
  label: string;
  selected: boolean;
}

interface SelectableListProps<T> {
  empty: string;
  items: readonly T[];
  onSelect: (id: string) => void;
}

export function MemberList({ empty, items, onSelect }: SelectableListProps<TuiMember>) {
  const select = useCallback((event: MouseEvent) => {
    const id = (event.currentTarget as HTMLElement).dataset.entity;
    if (id) onSelect(id);
  }, [onSelect]);

  if (items.length === 0) return <div class="empty">{empty}</div>;
  return <>{items.map((item) => (
    <button
      class={`option${item.selected ? ' selected' : ''}`}
      data-entity={item.id}
      key={item.id}
      onClick={select}
      type="button"
    >
      <span class="option-main">{item.icon} {item.label}{item.isPlayer ? ' ← you' : ''}</span>
      <span class="option-meta">{item.kind}</span>
    </button>
  ))}</>;
}

export function ExitList({ empty, items, onSelect }: SelectableListProps<TuiExit>) {
  const select = useCallback((event: MouseEvent) => {
    const index = (event.currentTarget as HTMLElement).dataset.exitIndex;
    if (index !== undefined) onSelect(index);
  }, [onSelect]);

  if (items.length === 0) return <div class="empty">{empty}</div>;
  return <>{items.map((item) => (
    <button class="option" data-exit-index={item.index} key={item.key} onClick={select} type="button">
      <span class="option-main">🚪 {item.label}</span>
      <span class="option-meta">{item.locked ? 'locked' : ''}</span>
    </button>
  ))}</>;
}

export function InventoryList({ empty, items, onSelect }: SelectableListProps<TuiInventoryItem>) {
  const select = useCallback((event: MouseEvent) => {
    const id = (event.currentTarget as HTMLElement).dataset.entity;
    if (id) onSelect(id);
  }, [onSelect]);

  if (items.length === 0) return <div class="empty">{empty}</div>;
  return <>{items.map((item) => (
    <button
      class={`option${item.selected ? ' selected' : ''}`}
      data-entity={item.id}
      key={item.id}
      onClick={select}
      type="button"
    >
      <span class="option-main">{item.icon} {item.label}</span>
      <span class="option-meta">{item.kind}</span>
    </button>
  ))}</>;
}

export interface WorldListsProps {
  exits: readonly TuiExit[];
  inventory: readonly TuiInventoryItem[];
  inventoryEmpty: string;
  members: readonly TuiMember[];
  onExit: (index: number) => void;
  onSelect: (id: string) => void;
}

export function renderWorldLists(
  roots: { doors: HTMLElement; inventory: HTMLElement; members: HTMLElement },
  props: WorldListsProps,
) {
  render(<MemberList empty="Select a character above to play as and see their room." items={props.members} onSelect={props.onSelect} />, roots.members);
  render(<ExitList empty="No visible exits." items={props.exits} onSelect={(value) => props.onExit(Number(value))} />, roots.doors);
  render(<InventoryList empty={props.inventoryEmpty} items={props.inventory} onSelect={props.onSelect} />, roots.inventory);
}

type TuiPageWindow = Window & {
  BunnylandToolPreact?: { renderWorldLists?: typeof renderWorldLists };
  app?: { _renderWorld?: () => void };
};

const pageWindow = window as TuiPageWindow;
pageWindow.BunnylandToolPreact ??= {};
pageWindow.BunnylandToolPreact.renderWorldLists = renderWorldLists;
pageWindow.app?._renderWorld?.();
