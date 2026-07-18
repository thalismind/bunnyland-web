import { useCallback } from 'preact/hooks';

export interface ChatCharacter {
  characterId: string;
  hasHistory: boolean;
  kind: string;
  name: string;
  selected: boolean;
  suspended: boolean;
}

interface CharacterListProps {
  characters: readonly ChatCharacter[];
  emptyMessage: string;
  onSelect: (id: string) => void;
}

export function CharacterList({ characters, emptyMessage, onSelect }: CharacterListProps) {
  const select = useCallback((event: MouseEvent) => {
    const id = (event.currentTarget as HTMLElement).dataset.id;
    if (id) onSelect(id);
  }, [onSelect]);

  if (characters.length === 0) return <div class="side-empty">{emptyMessage}</div>;
  return <>{characters.map((character) => (
    <button
      class={`character-row ${character.selected ? 'active' : ''} ${character.hasHistory ? 'has-history' : ''}`}
      data-id={character.characterId}
      key={character.characterId}
      onClick={select}
      type="button"
    >
      <strong>{character.name}</strong>
      <span class="character-meta">
        {character.hasHistory && <span class="history-icon" aria-label="Has chat history" title="Has chat history">●</span>}
        {character.suspended ? 'suspended' : character.kind}
      </span>
    </button>
  ))}</>;
}
