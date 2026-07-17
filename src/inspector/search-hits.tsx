import { render } from 'preact';
import { useCallback } from 'preact/hooks';

export interface InspectorSearchHit {
  icon: string;
  id: string;
  name: string;
  type: string;
}

interface SearchHitsProps {
  activeIndex: number;
  hits: readonly InspectorSearchHit[];
  onPick: (id: string) => void;
}

export function SearchHits({ activeIndex, hits, onPick }: SearchHitsProps) {
  const pick = useCallback((event: MouseEvent) => {
    const id = (event.currentTarget as HTMLElement).dataset.selectEntity;
    if (id) onPick(id);
  }, [onPick]);

  if (hits.length === 0) return <div class="search-empty">no matches</div>;
  return <>
    {hits.map((hit, index) => (
      <div
        class={`search-item${index === activeIndex ? ' active' : ''}`}
        data-i={index}
        data-select-entity={hit.id}
        key={hit.id}
        onMouseDown={pick}
      >
        <span class="si-icon">{hit.icon}</span>{' '}
        {hit.name} <span class="si-type">{hit.type}</span>
      </div>
    ))}
  </>;
}

export function renderSearchHits(
  root: HTMLElement,
  hits: readonly InspectorSearchHit[],
  activeIndex: number,
  onPick: (id: string) => void,
) {
  render(<SearchHits hits={hits} activeIndex={activeIndex} onPick={onPick} />, root);
}

type InspectorSearchBridge = { renderSearchHits?: typeof renderSearchHits };
type InspectorSearchWindow = Window & {
  BunnylandInspectorPreact?: InspectorSearchBridge;
  app?: { _renderSearchHits?: () => void };
};

const bridgeWindow = window as InspectorSearchWindow;
bridgeWindow.BunnylandInspectorPreact ??= {};
bridgeWindow.BunnylandInspectorPreact.renderSearchHits = renderSearchHits;
bridgeWindow.app?._renderSearchHits?.();
