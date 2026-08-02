import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CharacterPage,
  characterInitials,
  type CharacterServices,
  parseLlmControllerOptions,
  type SheetProjection,
} from '../src/character/page';

const PROJECTION: SheetProjection = {
  characterId: 'character:one',
  characterName: 'Dr. Hazel',
  controller: { controller_id: 'llm:hazel', generation: 2, kind: 'llm', name: 'default' },
  points: { action: 4, action_max: 5, focus: 2, focus_max: 3 },
  portrait: { url: '/portrait.png' },
  room: {
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

function makeServices(
  projection: () => SheetProjection = () => structuredClone(PROJECTION),
  features: Record<string, boolean> = { character_chat: true, character_sheets: true },
) {
  const closeMenu = vi.fn();
  const services: CharacterServices = {
    actionIcon: () => '💬',
    applyConfig: vi.fn(async () => ({})),
    assignController: vi.fn(async () => undefined),
    fetchCharacterList: vi.fn(async () => ({
      characters: [{ id: 'character:one', kind: 'character', name: 'Hazel' }], epoch: 12,
    })),
    fetchCharacterProfile: vi.fn(async () => projection()),
    fetchLlmControllers: vi.fn(async () => [{
      detail: 'ollama/deepseek-v4-flash', id: 'llm:default', label: 'default',
    }]),
    formatPoints: (value) => String(Number(value || 0)),
    initClientMenu: () => ({ close: closeMenu }),
    initTheme: vi.fn(),
    mediaUrl: (base, url) => `${base}${url}`,
    normalizeBase: (url) => url.replace(/\/$/, ''),
    persistentClientId: () => 'chat-test-client',
    portraitStatusMessage: (current) => current?.portrait?.url ? 'Portrait ready.' : 'Portrait pending.',
    sendJson: vi.fn(async (_base, path, options) => {
      if (path.endsWith('/public/features')) return features;
      if (path.endsWith('/jobs')) return {
        id: 'job:chat', status: 'succeeded', result: { reply: 'Hello back.' },
      };
      if (path.endsWith('/jobs/job%3Achat')) return {
        id: 'job:chat', status: 'succeeded', result: { reply: 'Hello back.' },
      };
      return JSON.parse(options?.body || '{}') as Record<string, unknown>;
    }),
    serverFromUrl: () => '/api',
    setServerInUrl: vi.fn(),
    uploadCharacterImage: vi.fn(async () => ({ url: '/uploaded.png' })),
  };
  return { closeMenu, services };
}

beforeEach(() => {
  history.replaceState(null, '', '/character.html#character%3Aone');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  history.replaceState(null, '', '/character.html');
});

describe('full Character page', () => {
  it('parses and sorts existing LLM controllers from an admin world snapshot', () => {
    expect(parseLlmControllerOptions({ entities: [
      { id: 'web:one', components: { WebControllerComponent: { label: 'Browser' } } },
      { id: 'llm:two', components: { LLMControllerComponent: {
        model: 'deepseek-v4-flash', profile_name: 'writer', provider: 'ollama',
      } } },
      { id: 'llm:one', components: { LLMControllerComponent: { profile_name: 'default' } } },
    ] })).toEqual([
      { detail: '', id: 'llm:one', label: 'default' },
      { detail: 'ollama/deepseek-v4-flash', id: 'llm:two', label: 'writer' },
    ]);
    expect(() => parseLlmControllerOptions({ entities: {} })).toThrow(
      'World snapshot entities must be an array.',
    );
  });

  it('projects keyed character stats in place without a claim', async () => {
    let current = PROJECTION;
    const runtime = makeServices(() => current);
    const view = render(<CharacterPage services={runtime.services} />);
    await waitFor(() => expect(view.container.querySelector('[data-metric="Health"]')).toBeTruthy());
    const originalHealth = view.container.querySelector('[data-metric="Health"]');
    expect(view.container.querySelector('#character-name')?.textContent).toBe('Dr. Hazel');
    expect(view.container.querySelector('#vitals')?.textContent).toContain('Health');
    expect(view.container.querySelector('#vitals')?.textContent).not.toContain('Initiative');
    expect(runtime.services.fetchCharacterProfile).toHaveBeenCalledWith('/api', 'character:one');
    expect(view.container.querySelector('#actions')).toBeNull();
    expect(view.container.querySelector('#inventory')).toBeNull();

    current = {
      ...PROJECTION,
      sheet: {
        ...PROJECTION.sheet,
        vitals: [
          { label: 'Health', maximum: 10, text: '9 / 10', value: 9 },
          { label: 'Initiative', text: '3', value: 3 },
        ],
      },
      worldEpoch: 13,
    };
    await appFacade()?.refresh();
    await waitFor(() => expect(view.container.querySelector('[data-metric="Health"]')?.textContent).toContain('9 / 10'));
    expect(view.container.querySelector('[data-metric="Health"]')).toBe(originalHealth);
  });

  it('delegates through the compatibility facade and closes menu effects on unmount', async () => {
    history.replaceState(null, '', '/character.html?server=%2Fapi#character%3Aone');
    const runtime = makeServices();
    const view = render(<CharacterPage services={runtime.services} />);
    await waitFor(() => expect(appFacade()?.projection?.characterId).toBe('character:one'));
    expect(characterInitials('Dr. Hazel Rowan')).toBe('HR');

    const currentProjection = appFacade()?.projection;
    if (currentProjection) currentProjection.characterName = 'Hazel Updated';
    appFacade()?.render();
    await waitFor(() => expect(view.container.querySelector('#character-name')?.textContent).toBe('Hazel Updated'));
    appFacade()?.selectCharacter('', { updateHash: true });
    await waitFor(() => expect(location.hash).toBe(''));
    expect(location.search).toBe('?server=%2Fapi');
    view.unmount();
    expect(runtime.closeMenu).toHaveBeenCalledOnce();
    expect(appFacade()).toBeUndefined();
  });

  it('switches to claim-free chat and preserves the server query', async () => {
    history.replaceState(null, '', '/character.html?server=%2Fapi#character%3Aone');
    const runtime = makeServices();
    const view = render(<CharacterPage services={runtime.services} />);
    await waitFor(() => expect(view.container.querySelector('#character-name')?.textContent).toBe('Dr. Hazel'));
    expect(view.container.querySelector('#tab-chat .chat-history-marker')).toBeNull();

    fireEvent.click(view.container.querySelector('#tab-chat')!);
    expect(location.search).toBe('?server=%2Fapi&view=chat');
    expect(view.container.querySelector('#chat-pane')).toBeTruthy();

    fireEvent.input(view.container.querySelector('#chat-input')!, { target: { value: 'Hello' } });
    fireEvent.click(view.container.querySelector('#btn-send')!);
    await waitFor(() => expect(view.container.querySelector('#transcript')?.textContent).toContain('Hello back.'));
    expect(view.container.querySelector('#tab-chat .chat-history-marker')).toBeTruthy();
    expect(view.container.querySelector('#tab-chat')?.getAttribute('aria-label')).toBe('Chat, history available');
    expect(runtime.services.sendJson).toHaveBeenCalledWith(
      '/api', '/chat/characters/character%3Aone/jobs', expect.objectContaining({ method: 'POST' }),
    );

    fireEvent.click(view.container.querySelector('#btn-clear-history')!);
    expect(view.container.querySelector('#tab-chat .chat-history-marker')).toBeNull();
    expect(view.container.querySelector('#tab-chat')?.getAttribute('aria-label')).toBe('Chat');

    fireEvent.click(view.container.querySelector('#tab-sheet')!);
    expect(location.search).toBe('?server=%2Fapi');
    expect(view.container.querySelector('#vitals')).toBeTruthy();
  });

  it('shows tool parameters with entity display names in chat history', async () => {
    const runtime = makeServices();
    runtime.services.sendJson = vi.fn(async (_base, path) => {
      if (path.endsWith('/public/features')) {
        return { character_chat: true, character_sheets: true };
      }
      if (path.endsWith('/jobs')) return {
        id: 'job:chat',
        result: {
          action: {
            command_id: 'command:inspect',
            parameters: { target_id: 'red apple' },
            status: 'executed',
            tool: 'inspect',
          },
          reply: 'It looks ripe.',
        },
        status: 'succeeded',
      };
      return {};
    });
    const view = render(<CharacterPage services={runtime.services} />);
    await waitFor(() => expect(view.container.querySelector('#character-name')?.textContent).toBe('Dr. Hazel'));
    fireEvent.click(view.container.querySelector('#tab-chat')!);

    fireEvent.input(view.container.querySelector('#chat-input')!, { target: { value: 'Inspect it' } });
    fireEvent.click(view.container.querySelector('#btn-send')!);

    await waitFor(() => expect(view.container.querySelector('.action-message strong')?.textContent)
      .toBe('inspect — target: red apple'));
  });

  it('shows a typing indicator until a queued provider reply arrives', async () => {
    const runtime = makeServices();
    runtime.services.sendJson = vi.fn(async (_base, path) => {
      if (path.endsWith('/public/features')) {
        return { character_chat: true, character_sheets: true };
      }
      if (path.endsWith('/jobs')) return { id: 'job:chat', status: 'queued' };
      if (path.endsWith('/jobs/job%3Achat')) {
        return {
          id: 'job:chat',
          result: { reply: 'The path is clear.' },
          status: 'succeeded',
        };
      }
      return {};
    });
    const view = render(<CharacterPage services={runtime.services} />);
    await waitFor(() => expect(view.container.querySelector('#character-name')?.textContent).toBe('Dr. Hazel'));
    fireEvent.click(view.container.querySelector('#tab-chat')!);

    fireEvent.input(view.container.querySelector('#chat-input')!, { target: { value: 'Is it safe?' } });
    fireEvent.click(view.container.querySelector('#btn-send')!);

    await waitFor(() => expect(view.container.querySelector('.typing-indicator')?.getAttribute(
      'aria-label',
    )).toBe('Dr. Hazel is typing'));
    expect((view.container.querySelector('#btn-send') as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(runtime.services.sendJson).toHaveBeenCalledWith(
      '/api', '/chat/characters/character%3Aone/jobs/job%3Achat',
    ), { timeout: 3000 });
    await waitFor(() => expect(view.container.querySelector('#transcript')?.textContent).toContain(
      'The path is clear.',
    ));
    expect(view.container.querySelector('.typing-indicator')).toBeNull();
  });

  it('marks the Chat tab when the selected character has persisted history', async () => {
    localStorage.setItem(
      'bunnyland.characterChat.history.chat-test-client.character:one',
      JSON.stringify({ messages: [{ role: 'user', text: 'Earlier hello' }], summary: '' }),
    );
    const runtime = makeServices();
    const view = render(<CharacterPage services={runtime.services} />);

    await waitFor(() => expect(view.container.querySelector('#tab-chat .chat-history-marker')).toBeTruthy());
    expect(view.container.querySelector('#tab-chat')?.textContent).toBe('Chat');
    expect(view.container.querySelector('#tab-chat')?.getAttribute('aria-label')).toBe('Chat, history available');
  });

  it('keeps history available but makes non-LLM character chat read-only', async () => {
    localStorage.setItem(
      'bunnyland.characterChat.history.chat-test-client.character:one',
      JSON.stringify({ messages: [{ role: 'character', text: 'Earlier reply' }], summary: '' }),
    );
    const runtime = makeServices(() => ({
      ...structuredClone(PROJECTION),
      controller: { controller_id: 'web:manual', generation: 3, kind: 'web', name: 'Manual' },
    }));
    const view = render(<CharacterPage services={runtime.services} />);

    await waitFor(() => expect(view.container.querySelector('#character-name')?.textContent).toBe('Dr. Hazel'));
    fireEvent.click(view.container.querySelector('#tab-chat')!);
    expect(view.container.querySelector('#transcript')?.textContent).toContain('Earlier reply');
    expect(view.container.querySelector('#chat-read-only')?.textContent).toContain('not assigned to an LLM controller');
    expect((view.container.querySelector('#chat-input') as HTMLTextAreaElement).readOnly).toBe(true);
    expect((view.container.querySelector('#btn-send') as HTMLButtonElement).disabled).toBe(true);
    expect(view.container.querySelector('#llm-controller-assignment')).toBeNull();

    fireEvent.click(view.container.querySelector('#btn-clear-history')!);
    expect(view.container.querySelector('#transcript')?.textContent).toContain('No local chat history');
  });

  it('lets an admin assign an existing LLM controller and refreshes chat access', async () => {
    let current: SheetProjection = {
      ...structuredClone(PROJECTION),
      controller: null,
    };
    const runtime = makeServices(() => structuredClone(current));
    runtime.services.assignController = vi.fn(async (_base, characterId, controllerId) => {
      current = {
        ...current,
        controller: { controller_id: controllerId, generation: 4, kind: 'llm', name: 'default' },
      };
      expect(characterId).toBe('character:one');
    });
    const view = render(<CharacterPage canAdminister services={runtime.services} />);

    await waitFor(() => expect(view.container.querySelector('#character-name')?.textContent).toBe('Dr. Hazel'));
    fireEvent.click(view.container.querySelector('#tab-chat')!);
    await waitFor(() => expect(view.container.querySelector('#btn-assign-llm-controller')).toBeTruthy());
    expect((view.container.querySelector('#chat-input') as HTMLTextAreaElement).readOnly).toBe(true);
    expect(view.container.querySelector('#llm-controller-select')?.textContent).toContain(
      'default · ollama/deepseek-v4-flash',
    );

    fireEvent.click(view.container.querySelector('#btn-assign-llm-controller')!);
    await waitFor(() => expect((view.container.querySelector('#chat-input') as HTMLTextAreaElement).readOnly).toBe(false));
    expect(runtime.services.assignController).toHaveBeenCalledWith(
      '/api', 'character:one', 'llm:default',
    );
    expect(view.container.querySelector('#chat-read-only')).toBeNull();
    expect(view.container.querySelector('#status-line')?.textContent).toContain('LLM controller assigned');
  });

  it('activates a suspended character with the default LLM controller', async () => {
    let current: SheetProjection = {
      ...structuredClone(PROJECTION),
      controller: { controller_id: 'suspended:one', generation: 3, kind: 'suspended', name: 'offline' },
      sheet: { ...structuredClone(PROJECTION.sheet), status: ['suspended'] },
    };
    const runtime = makeServices(() => structuredClone(current));
    runtime.services.fetchLlmControllers = vi.fn(async () => [
      { detail: 'ollama/other', id: 'llm:other', label: 'writer' },
      { detail: 'ollama/default', id: 'llm:default', label: 'default' },
    ]);
    runtime.services.assignController = vi.fn(async (_base, _characterId, controllerId) => {
      current = {
        ...current,
        controller: { controller_id: controllerId, generation: 4, kind: 'llm', name: 'default' },
        sheet: { ...current.sheet, status: ['active'] },
      };
    });
    const view = render(<CharacterPage canAdminister services={runtime.services} />);

    await waitFor(() => expect(view.container.querySelector('#character-name')?.textContent).toBe('Dr. Hazel'));
    fireEvent.click(view.container.querySelector('#tab-chat')!);
    await waitFor(() => expect(view.container.querySelector('#btn-assign-llm-controller')?.textContent)
      .toContain('Activate with default LLM'));
    fireEvent.click(view.container.querySelector('#btn-assign-llm-controller')!);

    await waitFor(() => expect(runtime.services.assignController).toHaveBeenCalledWith(
      '/api', 'character:one', 'llm:default',
    ));
    await waitFor(() => expect(view.container.querySelector('#status-line')?.textContent).toContain(
      'activated on the default LLM controller',
    ));
  });

  it.each([
    ['dead', 'dead and is not available to chat'],
    ['downed', 'unconscious and is not available to chat'],
    ['sleeping', 'sleeping and cannot be interrupted by chat'],
  ])('does not offer chat or controller assignment when the character is %s', async (status, reason) => {
    const runtime = makeServices(() => ({
      ...structuredClone(PROJECTION),
      controller: { controller_id: 'llm:hazel', generation: 2, kind: 'llm', name: 'default' },
      sheet: { ...structuredClone(PROJECTION.sheet), status: [status] },
    }));
    const view = render(<CharacterPage canAdminister services={runtime.services} />);

    await waitFor(() => expect(view.container.querySelector('#character-name')?.textContent).toBe('Dr. Hazel'));
    fireEvent.click(view.container.querySelector('#tab-chat')!);

    expect(view.container.querySelector('#chat-read-only')?.textContent).toContain(reason);
    expect((view.container.querySelector('#chat-input') as HTMLTextAreaElement).disabled).toBe(true);
    expect((view.container.querySelector('#btn-send') as HTMLButtonElement).disabled).toBe(true);
    expect(view.container.querySelector('#llm-controller-assignment')).toBeNull();
    expect(runtime.services.fetchLlmControllers).not.toHaveBeenCalled();
  });

  it('allows chat with a sleeping character when the server feature is enabled', async () => {
    const runtime = makeServices(
      () => ({
        ...structuredClone(PROJECTION),
        controller: { controller_id: 'llm:hazel', generation: 2, kind: 'llm', name: 'default' },
        sheet: { ...structuredClone(PROJECTION.sheet), status: ['sleeping'] },
      }),
      {
        allow_sleeping_character_chat: true,
        character_chat: true,
        character_sheets: true,
      },
    );
    const view = render(<CharacterPage services={runtime.services} />);

    await waitFor(() => expect(view.container.querySelector('#character-name')?.textContent).toBe('Dr. Hazel'));
    fireEvent.click(view.container.querySelector('#tab-chat')!);

    expect(view.container.querySelector('#chat-read-only')).toBeNull();
    expect((view.container.querySelector('#chat-input') as HTMLTextAreaElement).disabled).toBe(false);
    fireEvent.input(view.container.querySelector('#chat-input')!, { target: { value: 'Can you hear me?' } });
    fireEvent.click(view.container.querySelector('#btn-send')!);
    await waitFor(() => expect(view.container.querySelector('#transcript')?.textContent).toContain('Hello back.'));
  });

  it('uses connected polling without claim coordination', async () => {
    history.replaceState(null, '', '/character.html?server=%2Fapi#character%3Aone');
    const runtime = makeServices();
    const view = render(<CharacterPage services={runtime.services} />);

    await waitFor(() => expect(view.container.querySelector('#api-status')?.textContent).toBe('● Connected · epoch 12'));
    expect(runtime.services.fetchCharacterList).toHaveBeenCalled();
    expect(runtime.services.fetchCharacterProfile).toHaveBeenCalled();
  });

  it('preserves a manually scrolled chat position across profile refreshes', async () => {
    localStorage.setItem(
      'bunnyland.characterChat.history.chat-test-client.character:one',
      JSON.stringify({
        messages: Array.from({ length: 20 }, (_, index) => ({
          role: index % 2 ? 'character' : 'user',
          text: `Earlier message ${index}`,
        })),
        summary: '',
      }),
    );
    const runtime = makeServices();
    const view = render(<CharacterPage services={runtime.services} />);
    await waitFor(() => expect(view.container.querySelector('#character-name')?.textContent).toBe('Dr. Hazel'));
    fireEvent.click(view.container.querySelector('#tab-chat')!);

    const transcript = view.container.querySelector('#transcript') as HTMLDivElement;
    Object.defineProperties(transcript, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1000 },
    });
    transcript.scrollTop = 240;
    fireEvent.scroll(transcript);

    await appFacade()?.refresh();
    await waitFor(() => expect(runtime.services.fetchCharacterProfile).toHaveBeenCalledTimes(2));
    expect(transcript.scrollTop).toBe(240);
  });
});
