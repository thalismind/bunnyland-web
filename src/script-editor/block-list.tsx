import { EmptyState } from '@bunnyland/ui-web/preact';
import { useCallback } from 'preact/hooks';

export interface ScriptBlockItem {
  key: string;
  meta: string;
  name: string;
}

interface BlockListProps {
  blocks: readonly ScriptBlockItem[];
  onSelect: (index: number) => void;
  selectedIndex: number;
}

export function BlockList({ blocks, onSelect, selectedIndex }: BlockListProps) {
  const select = useCallback((event: MouseEvent) => {
    const index = Number((event.currentTarget as HTMLElement).dataset.index);
    if (Number.isInteger(index)) onSelect(index);
  }, [onSelect]);

  if (blocks.length === 0) return <EmptyState>No blocks.</EmptyState>;
  return <>
    {blocks.map((block, index) => (
      <div
        class={`block-row ${index === selectedIndex ? 'active' : ''}`}
        data-index={index}
        key={block.key}
        onClick={select}
      >
        <div class="block-name">{block.name}</div>
        <div class="block-meta">{block.meta}</div>
      </div>
    ))}
  </>;
}
