import { useCallback } from 'preact/hooks';

export interface InspectorSearchHit {
  icon: string;
  id: string;
  name: string;
  type: string;
}

export interface SearchHitsProps {
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
        aria-selected={index === activeIndex}
        class={`search-item${index === activeIndex ? ' active' : ''}`}
        data-i={index}
        data-select-entity={hit.id}
        id={`search-option-${index}`}
        key={hit.id}
        onMouseDown={pick}
        role="option"
      >
        <span aria-hidden="true" class="si-icon">{hit.icon}</span>{' '}
        {hit.name} <span class="si-type">{hit.type}</span>
      </div>
    ))}
  </>;
}
