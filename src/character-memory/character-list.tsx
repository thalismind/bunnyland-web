import { render } from 'preact';
import { useCallback } from 'preact/hooks';

export interface MemoryCollection {
  name: string;
  scope: string;
}

export interface MemoryCharacter {
  characterId: string;
  collections: readonly MemoryCollection[];
  name: string;
}

interface MemoryCharacterListProps {
  activeCollection: string;
  characters: readonly MemoryCharacter[];
  emptyMessage: string;
  onCollection: (name: string) => void;
}

export function MemoryCharacterList({
  activeCollection, characters, emptyMessage, onCollection,
}: MemoryCharacterListProps) {
  const selectCollection = useCallback((event: MouseEvent) => {
    const name = (event.currentTarget as HTMLElement).dataset.collection;
    if (name) onCollection(name);
  }, [onCollection]);

  if (characters.length === 0) return <div class="empty">{emptyMessage}</div>;
  return <>{characters.map((character) => (
    <div class="character-block" key={character.characterId}>
      <button class="character-row" type="button" data-character={character.characterId}>
        <span class="row-title">{character.name}</span>
        <span class="row-subtitle">{character.characterId}</span>
      </button>
      {character.collections.map((collection) => (
        <button
          class={`collection-row ${collection.name === activeCollection ? 'active' : ''}`}
          data-collection={collection.name}
          key={collection.name}
          onClick={selectCollection}
          type="button"
        >
          <span class="collection-scope">{collection.scope}</span>
          <span class="row-title">{collection.name}</span>
        </button>
      ))}
    </div>
  ))}</>;
}

export function renderMemoryCharacterList(root: HTMLElement, props: MemoryCharacterListProps) {
  render(<MemoryCharacterList {...props} />, root);
}

interface MemoryBridgeWindow {
  BunnylandPreact?: {
    renderMemoryCharacterList?: typeof renderMemoryCharacterList;
  };
  app?: { _renderCharacters?: () => void };
}

const bridgeWindow = window as unknown as MemoryBridgeWindow;
bridgeWindow.BunnylandPreact ??= {};
bridgeWindow.BunnylandPreact.renderMemoryCharacterList = renderMemoryCharacterList;
bridgeWindow.app?._renderCharacters?.();
