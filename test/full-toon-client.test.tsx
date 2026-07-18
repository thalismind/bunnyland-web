import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToonPage, type ToonRuntime } from '../src/toon-client/page';

const CHARACTER = 'character:1';
const OTHER = 'character:2';
const ITEM = 'item:1';

function harness() {
  const close = vi.fn();
  const submitted: Array<Record<string, unknown>> = [];
  let fetches = 0;
  const projection = {
    characterId: CHARACTER,
    room: { id: 'room:1', name: 'Parlor' },
    points: { action: 5, action_max: 5, focus: 3, focus_max: 3 },
    targetGroups: { characters: [{ id: OTHER, label: 'Marlow', kind: 'character' }] },
    inventory: [{ id: ITEM, name: 'Moon Key', kind: 'item' }],
    actions: [
      { command_type: 'say', tool_name: 'say', title: 'Say', lane: 'world', cost: { action: 1, focus: 1 }, arguments: [{ key: 'text', title: 'text', kind: 'string', required: true }] },
      { command_type: 'tell', tool_name: 'tell', title: 'Tell', lane: 'world', cost: { action: 1, focus: 1 }, arguments: [{ key: 'target_id', title: 'target', kind: 'entity', required: true, target_group: 'characters' }, { key: 'text', title: 'text', kind: 'string', required: true }] },
    ],
  };
  const functions: Record<string, (...args: unknown[]) => unknown> = {
    iconPreference: () => true,
    setIconPreference: () => undefined,
    fetchCharacterList: async () => { fetches += 1; return { characters: [{ id: CHARACTER, name: 'Bun' }], epoch: 5 }; },
    fetchCharacterProjection: async () => projection,
    fetchQueuedCommands: async () => ({ characterId: CHARACTER, commands: [] }),
    fetchCharacterRecentEvents: async () => ({ events: [] }),
    fetchRoomProjection: async () => ({ room: { id: 'room:1', name: 'Parlor', entities: [{ id: CHARACTER, name: 'Bun', sprite: { position: { x: 20, y: 20 } } }, { id: OTHER, name: 'Marlow', sprite: { position: { x: 40, y: 40 } } }], exits: [] } }),
    drainNarratedEvents: (_messages, options) => ({ lines: [], seenIds: (options as { seenIds: Set<string> }).seenIds }),
    latestImageCompletion: () => null,
    syncClaimControl: control => control,
    persistentClientId: async () => 'toon-client',
    storedClaimControl: () => null,
    claimSettings: () => ({}),
    claimWebController: async () => ({ controller_id: 'web:1', generation: 1, claim_id: 'claim' }),
    controlFromResponse: () => ({ characterId: CHARACTER, controllerId: 'web:1', generation: 1, claimId: 'claim', active: true }),
    storeClaimControl: () => undefined,
    clearClaimControl: () => undefined,
    updateWebControllerFallback: async () => ({ controller_id: 'web:1', generation: 1, claim_id: 'claim' }),
    releaseWebController: async () => ({ controller_id: 'idle:1', generation: 2, claim_id: 'claim' }),
    releaseWebClaim: async () => ({}),
    playerControl: control => control,
    createPlayerLiveUpdates: () => ({ close }),
    actionTitle: action => (action as Record<string, string>).title,
    actionIcon: () => '✨',
    actionTool: action => (action as Record<string, string>).tool_name,
    actionLane: action => (action as Record<string, string>).lane,
    actionCost: action => (action as { cost: unknown }).cost,
    actionAvailable: action => (action as { available?: boolean }).available !== false,
    actionUnavailableReason: action => (action as { unavailable_reason?: string }).unavailable_reason || '',
    actionArguments: action => (action as { arguments: unknown[] }).arguments || [],
    actionFields: (action, targets) => (action as { arguments: Array<Record<string, unknown>> }).arguments.map(argument => ({
      key: argument.key, label: argument.title, kind: argument.kind, required: argument.required,
      ...(argument.target_group ? { candidates: (targets as (group: string) => Array<{ id: string; label: string }>)(String(argument.target_group)).map(candidate => ({ value: candidate.id, label: candidate.label })) } : {}),
    })),
    filterActions: (actions, filter) => (actions as Array<Record<string, string>>).filter(action => String(action.title).toLowerCase().includes(String(filter).toLowerCase())),
    submitCommand: async (_base, payload) => { submitted.push(payload as Record<string, unknown>); return { ok: true }; },
    entityIcon: () => '🐰',
    entityName: entity => String((entity as { name?: string }).name || (entity as { id?: string }).id),
    inventoryEntries: value => ((value as typeof projection | null)?.inventory || []).map(item => ({ icon: '🔑', id: item.id, kind: item.kind, label: item.name })),
    queuedCountdownSeconds: () => null,
    cancelQueuedCommand: async () => ({ cancelled: true }),
    queuedCommandName: () => '', queuedCommandCost: () => '', queuedCommandDetail: () => '',
    imageRequestMessage: () => 'Image requested',
    characterSheetHref: (_base, id) => `character-sheet.html#${String(id)}`,
  };
  const runtime: ToonRuntime = {
    api: {
      applyConfigToInput: async () => ({}), applyServerParam: options => {
        const server = new URLSearchParams(location.search).get('server') || '';
        if (server) (options as { connect(server: string): void }).connect(server);
        return server;
      }, mediaUrl: (_base, path) => path,
      normalizeBase: value => String(value).replace(/\/$/, ''), requestSceneImage: async () => ({}), setServerInUrl: value => {
        const url = new URL(location.href); const server = String(value);
        if (server) url.searchParams.set('server', server); else url.searchParams.delete('server');
        history.replaceState(null, '', url);
      },
    },
    play: functions,
    ui: { initClientMenu: () => undefined, initHelp: () => undefined },
  };
  return { close, fetches: () => fetches, runtime, submitted };
}

afterEach(() => {
  cleanup();
  history.replaceState(null, '', location.pathname);
});

describe('ToonPage', () => {
  it('delegates its read-only facade and deletes it on unmount', async () => {
    const test = harness();
    const view = render(<ToonPage runtime={test.runtime} />);
    fireEvent.input(view.container.querySelector('#api-url')!, { target: { value: '/api' } });
    fireEvent.click(view.container.querySelector('#btn-connect')!);
    await waitFor(() => expect(view.container.querySelectorAll('#player-select option')).toHaveLength(2));
    fireEvent.change(view.container.querySelector('#player-select')!, { target: { value: CHARACTER } });
    await waitFor(() => expect(view.container.querySelector('.verb[data-tool="say"]')).toBeTruthy());
    const app = (window as unknown as { app: { characterList: unknown[]; characterProjection: { characterId: string }; control: unknown; _playerInView(): boolean; _refresh(): Promise<void> } }).app;
    expect(app.characterList).toHaveLength(1);
    expect(app.characterProjection.characterId).toBe(CHARACTER);
    expect(app.control).toBeTruthy();
    expect(app._playerInView()).toBe(true);
    const before = test.fetches();
    await app._refresh();
    expect(test.fetches()).toBeGreaterThan(before);
    view.unmount();
    expect((window as unknown as { app?: unknown }).app).toBeUndefined();
    expect(test.close).toHaveBeenCalled();
  });

  it('keeps one action form open and submits the collected payload', async () => {
    const test = harness();
    const view = render(<ToonPage runtime={test.runtime} />);
    fireEvent.input(view.container.querySelector('#api-url')!, { target: { value: '/api' } });
    fireEvent.click(view.container.querySelector('#btn-connect')!);
    await waitFor(() => expect(view.container.querySelectorAll('#player-select option')).toHaveLength(2));
    fireEvent.change(view.container.querySelector('#player-select')!, { target: { value: CHARACTER } });
    await waitFor(() => expect(view.container.querySelector('.verb[data-tool="say"]')).toBeTruthy());
    fireEvent.click(view.container.querySelector('.verb[data-tool="say"]')!);
    expect(view.container.querySelectorAll('#action-form-overlay')).toHaveLength(1);
    fireEvent.click(view.container.querySelector('.af-submit')!);
    expect(view.container.querySelector('.af-error')?.textContent).toContain('required');
    fireEvent.input(view.container.querySelector('.af-input')!, { target: { value: 'hello toon' } });
    fireEvent.click(view.container.querySelector('.af-submit')!);
    await waitFor(() => expect(test.submitted).toHaveLength(1));
    expect(test.submitted[0]).toMatchObject({ command_type: 'say', payload: { text: 'hello toon' }, on_insufficient_points: 'queue' });
  });

  it('applies deep-linked targets and preserves the server query while targets change', async () => {
    history.replaceState(null, '', `?server=${encodeURIComponent('/api')}#${encodeURIComponent(OTHER)}`);
    const test = harness();
    const view = render(<ToonPage runtime={test.runtime} />);
    await waitFor(() => expect(view.container.querySelectorAll('#player-select option')).toHaveLength(2));
    expect(location.hash).toBe(`#${encodeURIComponent(OTHER)}`);
    expect(new URLSearchParams(location.search).get('server')).toBe('/api');

    fireEvent.change(view.container.querySelector('#player-select')!, { target: { value: CHARACTER } });
    await waitFor(() => expect(view.container.querySelector(`[data-id="${OTHER}"].selected`)).toBeTruthy());
    fireEvent.click(view.container.querySelector('.inventory-item')!);
    expect(decodeURIComponent(location.hash.slice(1))).toBe(ITEM);
    expect(new URLSearchParams(location.search).get('server')).toBe('/api');

    fireEvent.click(view.container.querySelector('#btn-clear-target')!);
    expect(location.hash).toBe('');
    expect(new URLSearchParams(location.search).get('server')).toBe('/api');

    history.replaceState(null, '', `?server=${encodeURIComponent('/api')}#${encodeURIComponent(OTHER)}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(view.container.querySelector(`[data-id="${OTHER}"].selected`)).toBeTruthy());
  });
});
