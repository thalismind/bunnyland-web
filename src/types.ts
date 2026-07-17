export interface WorldEntity {
  id: string;
  components?: Record<string, unknown>;
}

export interface EntityListItem extends WorldEntity {
  icon: string;
  invalid: boolean;
  name: string;
  type: string;
}

export interface ToonSprite {
  glyph: string;
  id: string;
  imageUrl?: string;
  isPlayer: boolean;
  label: string;
  layer: number;
  left: number;
  scale: number;
  selected: boolean;
  top: number;
}

export interface ToonDoor {
  direction: string;
  id: string;
  label: string;
  position: Partial<Record<'bottom' | 'left' | 'right' | 'top', string>>;
  title: string;
  transform?: string;
}
