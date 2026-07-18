import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CharacterSheetPage,
  characterInitials,
  type CharacterSheetServices,
  type SheetProjection,
} from '../src/character-sheet/app';

const PROJECTION: SheetProjection = {
  actions: [{
    available: true, command_type: 'say', cost: { action: 1 }, lane: 'world', title: 'Say', tool_name: 'say',
  }],
  characterId: 'character:one',
  characterName: 'Dr. Hazel',
  controller: { controller_id: 'web:sheet', generation: 2, kind: 'web', name: 'Sheet' },
  inventory: [{ id: 'item:key', kind: 'item', label: 'brass key' }],
  points: { action: 4, action_max: 5, focus: 2, focus_max: 3 },
  portrait: { url: '/portrait.png' },
  room: {
    entities: [
      { id: 'character:one', isCharacter: true, kind: 'character', name: 'Hazel' },
      { id: 'character:two', isCharacter: true, kind: 'character', name: 'Marlow' },
    ],
    id: 'room:parlor',
    title: 'Parlor',
  },
  sheet: {
    description: 'A careful scout.',
    kind: 'character',
    species: 'hare',
    status: ['alert'],
    traits: ['watchful'],
    vitals: [
      { label: 'Health', maximum: 10, text: '8 / 10', value: 8 },
      { label: 'Initiative', text: '3', value: 3 },
    ],
  },
  worldEpoch: 12,
};

interface SheetFacade {
  projection: SheetProjection | null;
  refresh: () => Promise<void>;
  render: () => void;
  selectCharacter: (id: string, options?: { updateHash?: boolean }) => void;
}

function appFacade(): SheetFacade | undefined {
  return (window as unknown as { app?: SheetFacade }).app;
}

function makeServices(projection: () => SheetProjection = () => PROJECTION) {
  const closeLive = vi.fn();
  const closeMenu = vi.fn();
  let liveOptions: Parameters<CharacterSheetServices['createPlayerLiveUpdates']>[0] | undefined;
  const services: CharacterSheetServices = {
    actionAvailable: (action) => action.available !== false,
    actionCost: (action) => ({ action: Number(action.cost?.action || 0), focus: Number(action.cost?.focus || 0) }),
    actionLane: (action) => action.lane || 'world',
    actionTitle: (action) => action.title || action.tool_name || action.command_type || 'Action',
    applyConfig: vi.fn(async () => ({})),
    createPlayerLiveUpdates: vi.fn((options) => {
      liveOptions = options;
      options.onState('live');
      void options.refresh();
      return { close: closeLive };
    }),
    fetchCharacterList: vi.fn(async () => ({
      characters: [{ id: 'character:one', kind: 'character', name: 'Hazel' }], epoch: 12,
    })),
    fetchCharacterProjection: vi.fn(async () => projection()),
    formatPoints: (value) => String(Number(value || 0)),
    initClientMenu: () => ({ close: closeMenu }),
    mediaUrl: (base, url) => `${base}${url}`,
    normalizeBase: (url) => url.replace(/\/$/, ''),
    orderActionsByAvailability: (actions) => actions,
    portraitStatusMessage: (current) => current?.portrait?.url ? 'Portrait ready.' : 'Portrait pending.',
    requestSceneImage: vi.fn(async () => ({ ok: true })),
    serverFromUrl: () => '/api',
    setServerInUrl: vi.fn(),
    storedClaimControl: vi.fn((_key, characterId) => ({ claimId: `claim:${characterId}`, claimSecret: 'secret' })),
    uploadCharacterImage: vi.fn(async () => ({ url: '/uploaded.png' })),
  };
  return { closeLive, closeMenu, getLiveOptions: () => liveOptions, services };
}

beforeEach(() => {
  history.replaceState(null, '', '/character-sheet.html#character%3Aone');
});

afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/character-sheet.html');
});

describe('full Character Sheet page', () => {
  it('projects keyed character details in place across live refreshes', async () => {
    let current = PROJECTION;
    const runtime = makeServices(() => current);
    const view = render(<CharacterSheetPage services={runtime.services} />);
    await waitFor(() => expect(view.container.querySelector('[data-row-key="item:key"]')).toBeTruthy());
    const originalInventory = view.container.querySelector('[data-row-key="item:key"]');
    expect(view.container.querySelector('#character-name')?.textContent).toBe('Dr. Hazel');
    expect(view.container.querySelector('#vitals')?.textContent).toContain('Health');
    expect(view.container.querySelector('#vitals')?.textContent).not.toContain('Initiative');
    expect(runtime.services.fetchCharacterProjection).toHaveBeenCalledWith(
      '/api', 'character:one', expect.objectContaining({ claimId: 'claim:character:one' }),
    );

    current = {
      ...PROJECTION,
      inventory: [{ id: 'item:key', kind: 'item', label: 'polished brass key' }],
      worldEpoch: 13,
    };
    await appFacade()?.refresh();
    await waitFor(() => expect(view.container.querySelector('[data-row-key="item:key"]')?.textContent).toContain('polished'));
    expect(view.container.querySelector('[data-row-key="item:key"]')).toBe(originalInventory);
  });

  it('preserves action-filter focus while projections update', async () => {
    const runtime = makeServices();
    const view = render(<CharacterSheetPage services={runtime.services} />);
    await waitFor(() => expect(view.container.querySelector('[data-row-key="say:say"]')).toBeTruthy());
    const filter = view.container.querySelector('#action-filter') as HTMLInputElement;
    filter.focus();
    fireEvent.input(filter, { target: { value: 'say' } });
    await appFacade()?.refresh();
    expect(view.container.querySelector('#action-filter')).toBe(filter);
    expect(filter.value).toBe('say');
    expect(document.activeElement).toBe(filter);
    fireEvent.click(view.container.querySelector('#action-filter-clear')!);
    await waitFor(() => expect(filter.value).toBe(''));
  });

  it('delegates through the compatibility facade and closes live effects on unmount', async () => {
    history.replaceState(null, '', '/character-sheet.html?server=%2Fapi#character%3Aone');
    const runtime = makeServices();
    const view = render(<CharacterSheetPage services={runtime.services} />);
    await waitFor(() => expect(appFacade()?.projection?.characterId).toBe('character:one'));
    expect(runtime.getLiveOptions()?.characterId).toBe('character:one');
    expect(characterInitials('Dr. Hazel Rowan')).toBe('HR');

    const currentProjection = appFacade()?.projection;
    if (currentProjection) currentProjection.characterName = 'Hazel Updated';
    appFacade()?.render();
    await waitFor(() => expect(view.container.querySelector('#character-name')?.textContent).toBe('Hazel Updated'));
    appFacade()?.selectCharacter('', { updateHash: true });
    await waitFor(() => expect(location.hash).toBe(''));
    expect(location.search).toBe('?server=%2Fapi');
    await waitFor(() => expect(runtime.closeLive).toHaveBeenCalledOnce());

    view.unmount();
    expect(runtime.closeMenu).toHaveBeenCalledOnce();
    expect(appFacade()).toBeUndefined();
  });
});
