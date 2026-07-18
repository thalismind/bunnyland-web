import { EmptyState } from '@bunnyland/ui-web/preact';

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
