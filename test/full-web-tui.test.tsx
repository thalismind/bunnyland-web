import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { AuthGate, AuthProvider } from '@bunnyland/ui-web/preact';
import type { ComponentType } from 'preact';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const character = { id: 'character:1', kind: 'character', name: 'Juniper' };
const control = {
  active: true, claimId: 'claim-web-tui', controllerId: 'web:tui', generation: 4,
};
const action = {
  arguments: [{ key: 'text', kind: 'string', label: 'Message', required: true }],
  command_type: 'tell', cost: { action: 1, focus: 1 }, lane: 'world', title: 'Tell', tool: 'tell',
};
const projection = {
  actions: [action],
  characterId: character.id,
  inventory: [{ icon: '🥕', id: 'item:1', kind: 'item', label: 'Carrot' }],
  points: { action: 2, action_max: 3, focus: 1, focus_max: 2 },
  room: {
    description: 'Paths leave the meadow in every direction.',
    entities: [character, { id: 'character:2', kind: 'character', name: 'Hazel' }],
    exits: [{ direction: 'north', id: 'room:2' }], id: 'room:1', title: 'Meadow',
  },
  targetGroups: { characters: [{ id: 'character:2', name: 'Hazel' }] },
  worldEpoch: 7,
};
const closeLive = vi.fn();
const fetchCharacterList = vi.fn(async () => ({ characters: [character], epoch: 7 }));
const fetchClaimProjection = vi.fn(async () => ({ character: projection, queued: { characterId: character.id, commands: [] } }));
const submitCommand = vi.fn(async () => ({ queued: true }));

const play = {
  IMAGE_AFFORDANCE: { DELIVER_EMOJI: '🖼', FAIL_EMOJI: '⚠', REQUEST_EMOJI: '📷' },
  actionArguments: vi.fn((value: typeof action) => value.arguments ?? []),
  actionAvailable: vi.fn(() => true),
  actionCommandType: vi.fn((value: typeof action) => value.command_type),
  actionCost: vi.fn((value: typeof action) => value.cost),
  actionFields: vi.fn((value: typeof action) => value.arguments),
  actionIcon: vi.fn(() => '💬'),
  actionLane: vi.fn((value: typeof action) => value.lane),
  actionTitle: vi.fn((value: typeof action) => value.title),
  actionTool: vi.fn((value: typeof action) => value.tool),
  actionUnavailableReason: vi.fn(() => ''),
  allTargets: vi.fn(() => [{ label: 'Hazel', value: 'character:2' }]),
  cancelQueuedCommand: vi.fn(async () => undefined),
  characterHref: vi.fn(() => 'character.html?id=character%3A1'),
  claimSettings: vi.fn(() => ({})),
  claimWebController: vi.fn(async () => ({})),
  clearClaimControl: vi.fn(),
  controlFromResponse: vi.fn(() => control),
  createPlayerLiveUpdates: vi.fn(() => ({ close: closeLive })),
  drainNarratedEvents: vi.fn((_events: unknown[], options: { seenIds: Set<string> }) => ({
    lines: [], seenIds: options.seenIds,
  })),
  entityIcon: vi.fn(() => '🐇'),
  fetchCharacterList,
  fetchClaimProjection,
  fetchCharacterRecentEvents: vi.fn(async () => ({ events: [] })),
  filterActions: vi.fn((values: unknown[]) => values),
  formatPoints: vi.fn((value: number) => String(value ?? 0)),
  iconPreference: vi.fn(() => true),
  imageRequestMessage: vi.fn(() => 'image requested'),
  inventoryEntries: vi.fn((value: typeof projection | null) => value?.inventory ?? []),
  isClaimNotFoundError: vi.fn((error: unknown) => (error as { status?: number })?.status === 404),
  latestImageCompletion: vi.fn(() => null),
  latestImageFailure: vi.fn(() => null),
  persistentClientId: vi.fn(() => 'web-tui-client'),
  queuedCommandLabel: vi.fn(() => 'Tell'),
  queuedCountdownSeconds: vi.fn(() => null),
  releaseWebClaim: vi.fn(async () => ({})),
  releaseWebController: vi.fn(async () => ({})),
  setIconPreference: vi.fn(),
  storeClaimControl: vi.fn(),
  storedClaimControl: vi.fn(() => null),
  submitCommand,
  syncClaimControl: vi.fn((value: unknown) => value),
  updateWebControllerFallback: vi.fn(async () => ({})),
};
const bunnylandApi = {
  applyConfigToInput: vi.fn(async () => undefined),
  applyServerParam: vi.fn(),
  normalizeBase: vi.fn((value: string) => value.replace(/\/$/, '')),
  requestSceneImage: vi.fn(async () => ({})),
  sendJson: vi.fn(async () => ({
    world_id: 'world-1', world_epoch: 7, title: 'Clover City', description: '', content_flags: [],
  })),
  setServerInUrl: vi.fn(),
};
const bunnylandUi = { initClientMenu: vi.fn(), initHelp: vi.fn() };

type TestFacade = {
  readonly characters: typeof character[];
  readonly control: typeof control | null;
  readonly projection: typeof projection | null;
  refresh(): Promise<void>;
};
let WebTuiPage: ComponentType;

beforeAll(async () => {
  vi.stubGlobal('BunnylandApi', bunnylandApi);
  vi.stubGlobal('BunnylandPlay', play);
  vi.stubGlobal('BunnylandUI', bunnylandUi);
  ({ WebTuiPage } = await import('../src/web-tui/app'));
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '/web-tui.html');
  fetchCharacterList.mockResolvedValue({ characters: [character], epoch: 7 });
  fetchClaimProjection.mockResolvedValue({ character: projection, queued: { characterId: character.id, commands: [] } });
  bunnylandApi.sendJson.mockResolvedValue({
    world_id: 'world-1', world_epoch: 7, title: 'Clover City', description: '', content_flags: [],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

async function connectAndSelect(container: HTMLElement) {
  fireEvent.input(container.querySelector('#api-url')!, { target: { value: '/api/' } });
  fireEvent.click(container.querySelector('#btn-connect')!);
  await waitFor(() => expect(container.querySelectorAll('#player-select option')).toHaveLength(2));
  fireEvent.change(container.querySelector('#player-select')!, { target: { value: character.id } });
  await waitFor(() => expect(container.querySelector('#world-intro-title')).toBeTruthy());
  fireEvent.click(container.querySelector('.world-intro-dialog .primary')!);
  await waitFor(() => expect(container.querySelector('#room-title')?.textContent).toBe('Meadow'));
  expect(container.querySelector('#room-description')?.textContent).toBe(
    'Paths leave the meadow in every direction.',
  );
}

describe('WebTuiPage', () => {
  it('prompts for login and awaits the claim before starting the first live connection', async () => {
    let resolveClaim: (value: Record<string, unknown>) => void = () => undefined;
    play.claimWebController.mockImplementationOnce(() => new Promise(resolve => {
      resolveClaim = resolve;
    }));
    const authSession = {
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      rotate_after: null,
      rotation_eligible: false,
      scopes: ['world:play'],
      subject: 'player:juniper',
    };
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => (
      init?.method === 'POST'
        ? new Response(JSON.stringify(authSession), {
          headers: { 'Content-Type': 'application/json' },
        })
        : new Response(JSON.stringify({ detail: 'login required' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 401,
        })
    ));
    vi.stubGlobal('fetch', fetchMock);

    const view = render(
      <AuthProvider base="/api/v1">
        <AuthGate scopes={['world:play']}><WebTuiPage /></AuthGate>
      </AuthProvider>,
    );

    expect(view.container.querySelector('#btn-connect')).toBeNull();
    expect(play.claimWebController).not.toHaveBeenCalled();
    expect(play.createPlayerLiveUpdates).not.toHaveBeenCalled();
    fireEvent.click(await view.findByRole('button', { name: 'Login' }));
    fireEvent.input(view.getByLabelText('Username'), { target: { value: 'juniper' } });
    fireEvent.input(view.getByLabelText('Password'), { target: { value: 'correct horse' } });
    fireEvent.submit(view.getByRole('button', { name: 'Sign in' }).closest('form')!);
    await waitFor(() => expect(view.container.querySelector('#btn-connect')).toBeTruthy());
    const loginCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(loginCall?.[0]).toBe('/api/v1/auth/session');
    expect(loginCall?.[1]?.credentials).toBe('include');
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({
      delivery: 'cookie',
      password: 'correct horse',
      username: 'juniper',
    });

    fireEvent.input(view.container.querySelector('#api-url')!, { target: { value: '/api/' } });
    fireEvent.click(view.container.querySelector('#btn-connect')!);
    await waitFor(() => expect(view.container.querySelectorAll('#player-select option')).toHaveLength(2));
    fireEvent.change(view.container.querySelector('#player-select')!, { target: { value: character.id } });
    await waitFor(() => expect(view.container.querySelector('#world-intro-title')).toBeTruthy());
    fireEvent.click(view.container.querySelector('.world-intro-dialog .primary')!);
    await waitFor(() => expect(play.claimWebController).toHaveBeenCalledOnce());

    expect(play.claimWebController).toHaveBeenCalledWith('/api', expect.objectContaining({
      character_id: character.id,
      client_id: 'web-tui-client',
      label: 'web-tui',
    }), null);
    expect(play.createPlayerLiveUpdates).not.toHaveBeenCalled();

    resolveClaim({ id: control.claimId });
    await waitFor(() => expect(play.createPlayerLiveUpdates).toHaveBeenCalledWith(
      expect.objectContaining({
        base: '/api',
        characterId: character.id,
        control,
      }),
    ));
    expect(
      play.claimWebController.mock.invocationCallOrder[0],
    ).toBeLessThan(play.createPlayerLiveUpdates.mock.invocationCallOrder[0]);
  });

  it('blocks a character claim until the player accepts remote content flags', async () => {
    bunnylandApi.sendJson.mockResolvedValue({
      world_id: 'world-1', world_epoch: 7, title: 'Clover City', description: '', content_flags: ['adult:violence'],
    });
    const view = render(<WebTuiPage />);
    fireEvent.input(view.container.querySelector('#api-url')!, { target: { value: '/api/' } });
    fireEvent.click(view.container.querySelector('#btn-connect')!);
    await waitFor(() => expect(view.container.querySelectorAll('#player-select option')).toHaveLength(2));

    fireEvent.change(view.container.querySelector('#player-select')!, { target: { value: character.id } });
    expect(await view.findByRole('dialog', { name: 'Content warning' })).toBeTruthy();
    expect(play.claimWebController).not.toHaveBeenCalled();

    fireEvent.click(view.getByText('Accept and Join'));
    expect(await view.findByRole('dialog', { name: 'Clover City' })).toBeTruthy();
    expect(play.claimWebController).not.toHaveBeenCalled();
    fireEvent.click(view.getByText('Continue'));
    await waitFor(() => expect(play.claimWebController).toHaveBeenCalledOnce());
  });

  it('keeps keyed world and action nodes stable while delegating its exact read-only facade', async () => {
    const view = render(<WebTuiPage />);
    await connectAndSelect(view.container);
    const pageWindow = window as unknown as { app?: TestFacade };
    const facade = pageWindow.app;
    const member = view.container.querySelector('[data-entity="character:2"]');
    const actionRow = view.container.querySelector('[data-action-key="world:tell:tell"]');

    expect(Object.keys(facade ?? {})).toEqual(['characters', 'control', 'projection', 'refresh']);
    expect(Object.getOwnPropertyDescriptor(facade, 'characters')?.set).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(facade, 'control')?.set).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(facade, 'projection')?.set).toBeUndefined();
    expect(facade?.characters).toEqual([character]);
    expect(facade?.control).toBe(control);
    expect(facade?.projection).toBe(projection);

    const calls = fetchCharacterList.mock.calls.length;
    await facade?.refresh();
    await waitFor(() => expect(fetchCharacterList).toHaveBeenCalledTimes(calls + 1));
    expect(view.container.querySelector('[data-entity="character:2"]')).toBe(member);
    expect(view.container.querySelector('[data-action-key="world:tell:tell"]')).toBe(actionRow);
  });

  it('submits action forms through local state and removes live, timer, listener, and facade resources', async () => {
    const clearInterval = vi.spyOn(window, 'clearInterval');
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const view = render(<WebTuiPage />);
    await connectAndSelect(view.container);
    fireEvent.click(view.container.querySelector('[data-action-key="world:tell:tell"]')!);
    const input = view.container.querySelector<HTMLInputElement>('.form-input')!;
    fireEvent.input(input, { target: { value: 'hello' } });
    fireEvent.click(view.container.querySelector('.form-submit')!);

    await waitFor(() => expect(submitCommand).toHaveBeenCalledWith('/api', expect.objectContaining({
      character_id: character.id, command_type: 'tell', payload: { text: 'hello' },
    }), control));

    fireEvent.click(view.container.querySelector('[data-action-key="world:tell:tell"]')!);
    view.unmount();
    expect(closeLive).toHaveBeenCalled();
    expect(clearInterval).toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect((window as unknown as { app?: TestFacade }).app).toBeUndefined();
  });

  it('closes the action overlay on Escape', async () => {
    const view = render(<WebTuiPage />);
    await connectAndSelect(view.container);
    fireEvent.click(view.container.querySelector('[data-action-key="world:tell:tell"]')!);
    expect(view.container.querySelector('#action-form-overlay')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(view.container.querySelector('#action-form-overlay')).toBeNull();
  });

  it('clears an expired claim and leaves the selected character ready to reclaim', async () => {
    const view = render(<WebTuiPage />);
    await connectAndSelect(view.container);
    let rejectProjection: (reason: unknown) => void = () => undefined;
    fetchClaimProjection.mockImplementationOnce(() => new Promise((_, reject) => { rejectProjection = reject; }));
    const calls = fetchClaimProjection.mock.calls.length;

    const first = (window as unknown as { app: TestFacade }).app.refresh();
    const second = (window as unknown as { app: TestFacade }).app.refresh();
    await waitFor(() => expect(fetchClaimProjection).toHaveBeenCalledTimes(calls + 1));
    rejectProjection(Object.assign(new Error('claim does not exist'), { status: 404 }));
    await Promise.all([first, second]);

    await waitFor(() => expect(view.container.querySelector('#btn-release-character')?.textContent).toContain('Claim'));
    expect(play.clearClaimControl).toHaveBeenCalledWith('bunnyland.webTui.clientId', character.id);
    expect((window as unknown as { app: TestFacade }).app.control).toBeNull();
    expect((window as unknown as { app: TestFacade }).app.projection).toBeNull();
    expect(view.container.querySelector('#api-status')?.textContent).toContain('Claim expired');
    expect(closeLive).toHaveBeenCalled();
  });

  it('applies deep-linked targets and keeps the server query independent from target history', async () => {
    window.history.replaceState(null, '', '/web-tui.html?server=%2Fapi#character%3A2');
    const view = render(<WebTuiPage />);
    await connectAndSelect(view.container);
    await waitFor(() => expect(view.container.querySelector('#target-label')?.textContent).toBe('Target: Hazel'));
    expect(window.location.search).toBe('?server=%2Fapi');

    fireEvent.click(view.container.querySelector('[data-entity="item:1"]')!);
    expect(window.location.hash).toBe('#item%3A1');
    expect(window.location.search).toBe('?server=%2Fapi');
    fireEvent.click(view.container.querySelector('#btn-clear-target')!);
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?server=%2Fapi');

    window.history.replaceState(null, '', '/web-tui.html?server=%2Fapi#character%3A2');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(view.container.querySelector('#target-label')?.textContent).toBe('Target: Hazel'));
    window.history.replaceState(null, '', '/web-tui.html?server=%2Fapi#item%3A1');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(view.container.querySelector('#target-label')?.textContent).toBe('Target: Carrot'));
  });
});
