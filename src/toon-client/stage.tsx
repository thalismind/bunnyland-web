import type { ToonDoor, ToonSprite } from '../types';

export interface StageSpeechBubble {
  eventId: string;
  speakerId: string;
  text: string;
}

export interface StageItemsProps {
  bubbles?: readonly StageSpeechBubble[];
  doors: readonly ToonDoor[];
  onDoor: (id: string) => void;
  onSprite: (id: string) => void;
  sprites: readonly ToonSprite[];
}

export function StageItems({ bubbles = [], doors, onDoor, onSprite, sprites }: StageItemsProps) {
  const bubbleBySpeaker = new Map(bubbles.map(bubble => [bubble.speakerId, bubble]));

  return <>
    {sprites.map((sprite) => (
      <button
        aria-label={`${sprite.selected ? 'Clear target' : 'Target'} ${sprite.label}${sprite.isPlayer ? ' (you)' : ''}`}
        aria-pressed={sprite.selected}
        class={`sprite${sprite.isPlayer ? ' player' : ''}${sprite.selected ? ' selected' : ''}`}
        data-id={sprite.id}
        key={`sprite:${sprite.id}`}
        onClick={event => { event.stopPropagation(); onSprite(sprite.id); }}
        style={{ left: sprite.left, top: sprite.top, zIndex: 1000 + sprite.layer }}
        type="button"
      >
        {bubbleBySpeaker.get(sprite.id) && <div class="speech-bubble" aria-hidden="true">{bubbleBySpeaker.get(sprite.id)?.text}</div>}
        {sprite.imageUrl
          ? <img class="glyph" src={sprite.imageUrl} alt="" style={{ transform: `scale(${sprite.scale})` }} />
          : <div class="glyph" style={{ transform: `scale(${sprite.scale})` }}>{sprite.glyph}</div>}
        <div class="label">{sprite.label}</div>
      </button>
    ))}
    {doors.map((door) => (
      <button
        aria-label={door.title}
        class="door"
        data-id={door.id}
        disabled={door.disabled}
        key={`door:${door.id}`}
        onClick={event => { event.stopPropagation(); onDoor(door.id); }}
        style={{ ...door.position, transform: door.transform, zIndex: 5000 }}
        title={door.title}
        type="button"
      >
        🚪 {door.label}
        {door.direction && <span class="door-dir">{door.direction}</span>}
      </button>
    ))}
  </>;
}
