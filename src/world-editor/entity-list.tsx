import { EmptyState } from '@bunnyland/ui-web/preact';
import { useCallback } from 'preact/hooks';

import type { EntityListItem } from '../types';
import { moveRovingSelection } from '../roving-selection';

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
        aria-selected={entity.id === selectedId}
        class={`entity-row ${entity.id === selectedId ? 'active' : ''}`}
        data-editor-entity={entity.id}
        data-id={entity.id}
        key={entity.id}
        onClick={select}
        onKeyDown={event => moveRovingSelection(event, '[role="option"]', element => {
          const id = element.dataset.id;
          if (id) onSelect(id);
        })}
        role="option"
        tabIndex={entity.id === selectedId || selectedId === null && entity === entities[0] ? 0 : -1}
      >
        <div aria-hidden="true">{entity.icon}</div>
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
