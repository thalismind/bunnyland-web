import { render } from 'preact';
import { useCallback } from 'preact/hooks';

import type { ToonDoor, ToonSprite } from '../types';

export interface StageItemsProps {
  doors: readonly ToonDoor[];
  onDoor: (id: string) => void;
  onSprite: (id: string) => void;
  sprites: readonly ToonSprite[];
}

export function StageItems({ doors, onDoor, onSprite, sprites }: StageItemsProps) {
  const selectSprite = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    const id = (event.currentTarget as HTMLElement).dataset.id;
    if (id) onSprite(id);
  }, [onSprite]);
  const selectDoor = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    const id = (event.currentTarget as HTMLElement).dataset.id;
    if (id) onDoor(id);
  }, [onDoor]);

  return <>
    {sprites.map((sprite) => (
      <div
        class={`sprite${sprite.isPlayer ? ' player' : ''}${sprite.selected ? ' selected' : ''}`}
        data-id={sprite.id}
        key={`sprite:${sprite.id}`}
        onClick={selectSprite}
        style={{ left: sprite.left, top: sprite.top, zIndex: 1000 + sprite.layer }}
      >
        {sprite.imageUrl
          ? <img class="glyph" src={sprite.imageUrl} alt="" style={{ transform: `scale(${sprite.scale})` }} />
          : <div class="glyph" style={{ transform: `scale(${sprite.scale})` }}>{sprite.glyph}</div>}
        <div class="label">{sprite.label}</div>
      </div>
    ))}
    {doors.map((door) => (
      <div
        class="door"
        data-id={door.id}
        key={`door:${door.id}`}
        onClick={selectDoor}
        style={{ ...door.position, transform: door.transform, zIndex: 5000 }}
        title={door.title}
      >
        🚪 {door.label}
        {door.direction && <span class="door-dir">{door.direction}</span>}
      </div>
    ))}
  </>;
}

export function renderStageItems(root: HTMLElement, props: StageItemsProps) {
  render(<StageItems {...props} />, root);
}

window.BunnylandPreact ??= {};
window.BunnylandPreact.renderStageItems = renderStageItems;
window.app?.render?.();
