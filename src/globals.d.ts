import type { EntityListItem } from './types';
import type { StageItemsProps } from './toon-client/stage';

interface BunnylandLegacyApp {
  _renderEntities?: () => void;
  render?: () => void;
}

declare global {
  interface Window {
    app?: BunnylandLegacyApp;
    BunnylandPreact?: {
      renderEntityList?: (
        root: HTMLElement,
        entities: readonly EntityListItem[],
        selectedId: string | null,
        onSelect: (id: string) => void,
      ) => void;
      renderStageItems?: (root: HTMLElement, props: StageItemsProps) => void;
    };
  }
}

export {};
