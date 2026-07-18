import { EmptyState } from '@bunnyland/ui-web/preact';

export interface GeneratedEntityItem {
  generated: boolean;
  icon: string;
  id: string;
  kind: string;
  name: string;
}

interface GeneratedEntityListProps {
  entities: readonly GeneratedEntityItem[];
}

export function GeneratedEntityList({ entities }: GeneratedEntityListProps) {
  if (entities.length === 0) return <EmptyState id="empty-entities">No snapshot loaded.</EmptyState>;
  return <>
    {entities.map((entity) => (
      <div
        class={`entity-row ${entity.generated ? 'generated' : ''}`}
        data-id={entity.id}
        key={entity.id}
      >
        <div>{entity.icon}</div>
        <div>
          <div class="entity-name">{entity.name}</div>
          <div class="entity-meta">{entity.kind} · {entity.id}</div>
        </div>
      </div>
    ))}
  </>;
}
