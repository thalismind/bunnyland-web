import { EmptyState } from '@bunnyland/ui-web/preact';
import { useCallback } from 'preact/hooks';

import type { EntityListItem } from '../types';

interface EntityListProps {
  entities: readonly EntityListItem[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}

export function EntityList({ entities, onSelect, selectedId }: EntityListProps) {
  const select = useCallback((event: MouseEvent) => {
    const id = (event.currentTarget as HTMLElement).dataset.id;
    if (id) onSelect(id);
  }, [onSelect]);

  if (entities.length === 0) return <EmptyState>No entities.</EmptyState>;
  return <>
    {entities.map((entity) => (
      <div
        class={`entity-row ${entity.id === selectedId ? 'active' : ''}`}
        data-editor-entity={entity.id}
        data-id={entity.id}
        key={entity.id}
        onClick={select}
      >
        <div>{entity.icon}</div>
        <div>
          <div class="entity-name">{entity.name}</div>
          <div class="entity-meta">
            {entity.invalid && <span class="danger">invalid · </span>}
            {entity.type} · {entity.id}
          </div>
        </div>
      </div>
    ))}
  </>;
}
