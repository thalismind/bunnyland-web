import type {
  ActionView,
  CharacterProjection,
  ControlClaim,
  QueuedProjection,
  TargetOption,
} from '@bunnyland/ui-web/play';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WebReplPage, splitArgs, type WebReplServices } from '../src/web-repl/app';

const CONTROL: ControlClaim = {
  active: true,
  characterId: 'character:one',
  claimId: 'claim:one',
  claimSecret: 'secret',
  controllerId: 'web:repl',
  generation: 3,
};

const SAY: ActionView = {
  arguments: [{ key: 'text', kind: 'string', required: true, title: 'text' }],
  available: true,
  command_type: 'say',
  cost: { action: 1, focus: 1 },
  lane: 'world',
  title: 'Say',
  tool_name: 'say',
};

const PROJECTION: CharacterProjection = {
  actions: [SAY],
  characterId: 'character:one',
  characterName: 'Hazel',
  controller: { controller_id: 'web:repl', generation: 3 },
  inventory: [{ id: 'item:key', kind: 'item', label: 'brass key' }],
  points: { action: 5, action_max: 5, focus: 3, focus_max: 3 },
  portrait: {},
  room: {
    biome: 'inside',
    description: 'A bright parlor with a route map.',
    entities: [],
    exits: [],
    id: 'room:one',
    title: 'Parlor',
  } as CharacterProjection['room'] & { description: string },
  sheet: {},
  targetGroups: {},
  worldEpoch: 12,
};

const QUEUE: QueuedProjection = {
  characterId: 'character:one', commands: [], nextTickAtUnix: null, worldEpoch: 12,
};

interface ReplFacade {
  readonly characters: readonly { id: string }[];
  readonly control: ControlClaim | null;
  readonly projection: CharacterProjection | null;
  refresh: () => Promise<void>;
}

function facade(): ReplFacade | undefined {
  return (window as unknown as { app?: ReplFacade }).app;
}

function services(projection: () => CharacterProjection = () => PROJECTION) {
  const closeLive = vi.fn();
  const closeMenu = vi.fn();
  const service: WebReplServices = {
    actionArguments: (action) => action.arguments || [],
    actionAvailable: (action) => action.available !== false,
    actionCost: (action) => ({ action: Number(action.cost?.action || 0), focus: Number(action.cost?.focus || 0) }),
    actionIcon: () => '💬',
    actionLane: (action) => action.lane || 'world',
    actionTitle: (action) => action.title || action.command_type || 'Action',
    actionTool: (action) => action.tool_name || action.command_type || 'action',
    actionUnavailableReason: (action) => action.available === false ? action.unavailable_reason || 'Unavailable' : '',
    allTargets: (current) => current?.inventory.map((item): TargetOption => ({
      icon: '', kind: item.kind || 'item', label: item.label || item.id, value: item.id,
    })) || [],
    applyConfig: vi.fn(async () => ({})),
    cancelQueuedCommand: vi.fn(async () => ({ cancelled: true })),
    characterHref: (_base, id) => `character.html?server=%2Fapi#${id}`,
    claimSettings: () => ({ fallback_controller: 'suspend', timeout_seconds: 1800 }),
    claimWebController: vi.fn(async () => ({
      character_id: CONTROL.characterId,
      claim_id: CONTROL.claimId,
      claim_secret: CONTROL.claimSecret,
      controller_generation: CONTROL.generation,
      controller_id: CONTROL.controllerId,
    })),
    clearClaimControl: vi.fn(),
    controlFromResponse: (_data, _id, options) => ({ ...CONTROL, active: options.active }),
    createPlayerLiveUpdates: vi.fn((options) => {
      options.onState('live');
      return { close: closeLive };
    }),
    drainNarratedEvents: (_messages, options) => ({ lines: [], seenIds: options.seenIds }),
    fetchCharacterList: vi.fn(async () => ({
      characters: [{ id: 'character:one', kind: 'character', name: 'Hazel', suspended: false }],
      epoch: 12,
    })),
    fetchClaimProjection: vi.fn(async () => ({ character: projection(), queued: QUEUE })),
    fetchCharacterRecentEvents: vi.fn(async () => ({ events: [] })),
    fetchContentFlags: vi.fn(async () => ({
      world_id: 'world-1', world_epoch: 7, title: 'Clover City', description: '', content_flags: [],
    })),
    fetchFeatures: vi.fn(async () => ({ image_generation: true, video_generation: false })),
    formatPoints: (value) => String(Number(value || 0)),
    iconPreference: () => true,
    imageAffordance: { DELIVER_EMOJI: '📸', FAIL_EMOJI: '⚠️', REQUEST_EMOJI: '📷' },
    imageRequestMessage: () => '👀 image requested',
    videoAffordance: { DELIVER_EMOJI: '🎞️', FAIL_EMOJI: '⚠️', REQUEST_EMOJI: '🎬' },
    videoRequestMessage: () => '👀 video requested',
    initClientMenu: () => ({ close: closeMenu }),
    isClaimNotFoundError: (error) => (error as { status?: number })?.status === 404,
    isReferenceArg: (argument) => argument.kind === 'entity',
    latestImageCompletion: () => null,
    latestImageFailure: () => null,
    latestVideoCompletion: () => null,
    latestVideoFailure: () => null,
    normalizeBase: (url) => url.replace(/\/$/, ''),
    orderActionsByAvailability: (actions) => actions,
    persistentClientId: () => 'client:repl',
    playerControl: (current) => current,
    queuedCountdownSeconds: () => null,
    releaseWebClaim: vi.fn(async () => ({})),
    releaseWebController: vi.fn(async () => ({})),
    requestSceneImage: vi.fn(async () => ({ ok: true })),
    requestSceneVideo: vi.fn(async () => ({ ok: true })),
    resolveTargetName: (value, candidates) => candidates.find((item) => item.label === value || item.value === value) || null,
    serverFromUrl: () => '/api',
    setIconPreference: vi.fn(),
    setServerInUrl: vi.fn(),
    storeClaimControl: vi.fn(),
    storedClaimControl: () => null,
    submitCommand: vi.fn(async () => ({ ok: true })),
    suggestTargetNames: () => [],
    syncClaimControl: (current) => current,
    targetCandidates: (current) => service.allTargets(current),
    targetPrefix: (rest) => ({ raw: rest.split(' ')[0] || '', remaining: rest.split(' ').slice(1).join(' ') }),
    updateWebControllerFallback: vi.fn(async () => ({})),
  };
  return { closeLive, closeMenu, service };
}

async function selectPlayer(view: ReturnType<typeof render>): Promise<void> {
  await waitFor(() => expect(view.container.querySelector('#player-select option[value="character:one"]')).toBeTruthy());
  fireEvent.change(view.container.querySelector('#player-select')!, { target: { value: 'character:one' } });
  fireEvent.click(await view.findByText('Continue'));
  await waitFor(() => expect(view.container.querySelector('[data-action-key="world:say"]')).toBeTruthy());
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  history.replaceState(null, '', '/web-repl.html');
});

describe('full Web REPL page', () => {
  it('hides generation buttons unless each feature is advertised', async () => {
    const runtime = services();
    vi.mocked(runtime.service.fetchFeatures!).mockResolvedValue({
      image_generation: false,
      video_generation: true,
    });
    const view = render(<WebReplPage services={runtime.service} />);
    await waitFor(() => expect(view.container.querySelectorAll('#player-select option')).toHaveLength(2));
    expect(view.container.querySelector('#btn-request-image')).toBeNull();
    expect(view.container.querySelector('#btn-request-video')).toBeTruthy();
  });

  it('claims immediately when the world has no entry content', async () => {
    const runtime = services();
    vi.mocked(runtime.service.fetchContentFlags).mockResolvedValue({
      world_id: 'world-1', world_epoch: 7, title: '  ', description: '\n', content_flags: [],
    });
    const view = render(<WebReplPage services={runtime.service} />);
    await waitFor(() => expect(view.container.querySelector('#player-select option[value="character:one"]')).toBeTruthy());

    fireEvent.change(view.container.querySelector('#player-select')!, { target: { value: 'character:one' } });
    await waitFor(() => expect(runtime.service.claimWebController).toHaveBeenCalledOnce());
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('blocks claiming until flagged world content is accepted', async () => {
    const runtime = services();
    vi.mocked(runtime.service.fetchContentFlags).mockResolvedValue({
      world_id: 'world-1', world_epoch: 7, title: 'Clover City', description: '', content_flags: ['adult:violence'],
    });
    const view = render(<WebReplPage services={runtime.service} />);
    await waitFor(() => expect(view.container.querySelector('#player-select option[value="character:one"]')).toBeTruthy());

    fireEvent.change(view.container.querySelector('#player-select')!, { target: { value: 'character:one' } });
    expect(await view.findByRole('dialog', { name: 'Content warning' })).toBeTruthy();
    expect(runtime.service.claimWebController).not.toHaveBeenCalled();
    fireEvent.click(view.getByText('Accept and Join'));
    expect(await view.findByRole('dialog', { name: 'Clover City' })).toBeTruthy();
    expect(runtime.service.claimWebController).not.toHaveBeenCalled();
    fireEvent.click(view.getByText('Continue'));
    await waitFor(() => expect(runtime.service.claimWebController).toHaveBeenCalledOnce());
  });

  it('projects keyed actions and delegates read-only facade refreshes', async () => {
    let current = PROJECTION;
    const runtime = services(() => current);
    const view = render(<WebReplPage services={runtime.service} />);
    await selectPlayer(view);
    const original = view.container.querySelector('[data-action-key="world:say"]');
    expect(facade()?.characters).toHaveLength(1);
    expect(facade()?.control?.claimId).toBe('claim:one');
    expect(facade()?.projection?.characterId).toBe('character:one');
    current = { ...PROJECTION, points: { ...PROJECTION.points, action: 4 } };
    await facade()?.refresh();
    await waitFor(() => expect(view.container.querySelector('#side-status')?.textContent).toContain('AP 4/5'));
    expect(view.container.querySelector('[data-action-key="world:say"]')).toBe(original);
    expect(location.hash).toBe('#character%3Aone');
  });

  it('restores focused characters from the hash without dropping the server query', async () => {
    history.replaceState(null, '', '/web-repl.html?server=%2Fapi#character%3Aone');
    const runtime = services();
    const view = render(<WebReplPage services={runtime.service} />);
    fireEvent.click(await view.findByText('Continue'));
    await waitFor(() => expect(facade()?.projection?.characterId).toBe('character:one'));
    expect(view.container.querySelector<HTMLSelectElement>('#player-select')?.value).toBe('character:one');
    expect(location.search).toBe('?server=%2Fapi');

    history.replaceState(null, '', '/web-repl.html?server=%2Fapi');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(view.container.querySelector<HTMLSelectElement>('#player-select')?.value).toBe(''));
    expect(location.search).toBe('?server=%2Fapi');
  });

  it('submits commands and preserves input focus and history', async () => {
    const runtime = services();
    const view = render(<WebReplPage services={runtime.service} />);
    await selectPlayer(view);
    const input = view.container.querySelector('#repl-input') as HTMLInputElement;
    input.focus();
    fireEvent.input(input, { target: { value: 'say hello hooks' } });
    fireEvent.submit(view.container.querySelector('#prompt-row')!);
    await waitFor(() => expect(runtime.service.submitCommand).toHaveBeenCalled());
    expect(runtime.service.submitCommand).toHaveBeenCalledWith(
      '/api',
      expect.objectContaining({ command_type: 'say', payload: { text: 'hello hooks' } }),
      expect.objectContaining({ claimId: 'claim:one' }),
    );
    expect(view.container.querySelector('#repl-input')).toBe(input);
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('say hello hooks');
  });

  it('includes the room description in local look output', async () => {
    const runtime = services();
    const view = render(<WebReplPage services={runtime.service} />);
    await selectPlayer(view);
    const input = view.container.querySelector('#repl-input') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'look' } });
    fireEvent.submit(view.container.querySelector('#prompt-row')!);
    expect(view.getByText('A bright parlor with a route map.')).toBeTruthy();
  });

  it('clears an expired claim and leaves the selected character ready to reclaim', async () => {
    const runtime = services();
    const view = render(<WebReplPage services={runtime.service} />);
    await selectPlayer(view);
    let rejectProjection: (reason: unknown) => void = () => undefined;
    vi.mocked(runtime.service.fetchClaimProjection).mockImplementationOnce(
      () => new Promise((_, reject) => { rejectProjection = reject; }),
    );
    const calls = vi.mocked(runtime.service.fetchClaimProjection).mock.calls.length;

    const first = facade()?.refresh();
    const second = facade()?.refresh();
    await waitFor(() => expect(runtime.service.fetchClaimProjection).toHaveBeenCalledTimes(calls + 1));
    rejectProjection(Object.assign(new Error('claim does not exist'), { status: 404 }));
    await Promise.all([first, second]);

    await waitFor(() => expect(facade()?.control).toBeNull());
    expect(runtime.service.clearClaimControl).toHaveBeenCalledWith(
      'bunnyland.webRepl.clientId', 'character:one',
    );
    expect(facade()?.projection).toBeNull();
    expect(view.container.querySelector('#api-status')?.textContent).toContain('Claim expired');
    expect(view.container.querySelector('#btn-claim-menu')?.textContent).toContain('Claim');
    await waitFor(() => expect(runtime.closeLive).toHaveBeenCalled());
  });

  it('cleans live/menu/timer effects and removes its compatibility facade', async () => {
    const runtime = services();
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const view = render(<WebReplPage services={runtime.service} />);
    await selectPlayer(view);
    view.unmount();
    expect(runtime.closeLive).toHaveBeenCalledOnce();
    expect(runtime.closeMenu).toHaveBeenCalledOnce();
    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(facade()).toBeUndefined();
    clearIntervalSpy.mockRestore();
  });

  it('parses named arguments without losing continuation words', () => {
    expect(splitArgs('target=Marlow text=hello from the burrow')).toEqual({
      target: 'Marlow', text: 'hello from the burrow',
    });
  });
});
