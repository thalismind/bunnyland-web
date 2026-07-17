import { EmptyState } from '@bunnyland/ui-web/preact';
import { render } from 'preact';

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

export function renderGeneratedEntityList(root: HTMLElement, entities: readonly GeneratedEntityItem[]) {
  render(<GeneratedEntityList entities={entities} />, root);
}

type WorldGeneratorBridge = {
  renderGeneratedEntityList?: typeof renderGeneratedEntityList;
};
type WorldGeneratorWindow = Window & {
  BunnylandWorldGeneratorPreact?: WorldGeneratorBridge;
  app?: { _renderEntities?: () => void };
};

const bridgeWindow = window as WorldGeneratorWindow;
bridgeWindow.BunnylandWorldGeneratorPreact ??= {};
bridgeWindow.BunnylandWorldGeneratorPreact.renderGeneratedEntityList = renderGeneratedEntityList;
bridgeWindow.app?._renderEntities?.();
