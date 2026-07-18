import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorldGeneratorPage, generatorUsesSeed } from '../src/world-generator/app';

const initialSnapshot = {
  entities: [{
    id: 'room:old',
    components: {
      IdentityComponent: { kind: 'room', name: 'Old Room' },
      RoomComponent: { title: 'Old Room' },
    },
  }],
  metadata: { generator: 'empty', seed: 'old marsh' },
  world_epoch: 4,
};

class SocketStub {
  static instances: SocketStub[] = [];

  close = vi.fn();
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    SocketStub.instances.push(this);
  }

  emit(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
}

function entityType(entity: { components?: Record<string, unknown> }) {
  if (entity.components?.RoomComponent) return 'room';
  if (entity.components?.CharacterComponent) return 'character';
  return 'other';
}

const api = {
  applyConfigToInput: vi.fn(async () => ({})),
  applyServerParam: vi.fn(() => ''),
  normalizeBase: vi.fn((url: string) => url.replace(/\/$/, '')),
  sendAdmin: vi.fn(async (_base: string, path: string) => {
    if (path === '/admin/world/generators') {
      return { generators: [
        { name: 'empty', uses_seed: false },
        { name: 'recursive', uses_seed: true },
      ] };
    }
    if (path === '/admin/world/generate') return { job_id: 'job-1', status: 'queued' };
    return { job_id: 'job-1', status: 'succeeded' };
  }),
  sendJson: vi.fn(async () => initialSnapshot),
  setServerInUrl: vi.fn(),
  socketUrl: vi.fn(() => 'ws://localhost/ws'),
};

beforeEach(() => {
  SocketStub.instances = [];
  vi.clearAllMocks();
  vi.stubGlobal('BunnylandApi', api);
  vi.stubGlobal('BunnylandUI', { initClientMenu: vi.fn() });
  vi.stubGlobal('BunnylandWorld', {
    entityDisplayName: (entity: { id: string; components?: Record<string, { name?: string; title?: string }> }) =>
      entity.components?.IdentityComponent?.name ?? entity.components?.RoomComponent?.title ?? entity.id,
    entityType,
  });
  vi.stubGlobal('WebSocket', SocketStub);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('WorldGeneratorPage', () => {
  it('connects, loads generator controls, and validates destructive generation', async () => {
    const view = render(<WorldGeneratorPage />);
    fireEvent.click(view.getByText('Connect'));

    await waitFor(() => expect(view.getByText('2 generators')).toBeTruthy());
    expect(view.getByText('Old Room')).toBeTruthy();
    const seed = view.container.querySelector<HTMLTextAreaElement>('#seed-input')!;
    const select = view.container.querySelector<HTMLSelectElement>('#generator-select')!;
    fireEvent.change(select, { target: { value: 'empty' } });
    expect(seed.disabled).toBe(true);
    fireEvent.change(select, { target: { value: 'recursive' } });
    expect(seed.disabled).toBe(false);

    fireEvent.click(view.getByText('Generate New World'));
    expect(await view.findByText('Confirm reset before generating a replacement world')).toBeTruthy();
    expect(api.sendAdmin).not.toHaveBeenCalledWith(
      expect.anything(), '/admin/world/generate', expect.anything(),
    );
  });

  it('retains keyed entity rows when a socket snapshot adds an entity', async () => {
    const view = render(<WorldGeneratorPage />);
    fireEvent.click(view.getByText('Connect'));
    await waitFor(() => expect(SocketStub.instances).toHaveLength(1));
    const original = view.container.querySelector('[data-id="room:old"]');

    SocketStub.instances[0]!.emit({
      type: 'snapshot',
      data: {
        ...initialSnapshot,
        entities: [
          ...initialSnapshot.entities,
          { id: 'char:new', components: {
            CharacterComponent: {}, IdentityComponent: { kind: 'character', name: 'Juniper' },
          } },
        ],
      },
    });

    await waitFor(() => expect(view.getByText('Juniper')).toBeTruthy());
    expect(view.container.querySelector('[data-id="room:old"]')).toBe(original);
    expect(view.container.querySelector('[data-id="char:new"]')?.classList.contains('generated')).toBe(true);
  });

  it('closes its socket and cancels generation polling on unmount', async () => {
    const abort = vi.spyOn(AbortController.prototype, 'abort');
    const view = render(<WorldGeneratorPage />);
    fireEvent.click(view.getByText('Connect'));
    await waitFor(() => expect(SocketStub.instances).toHaveLength(1));
    fireEvent.click(view.container.querySelector('#confirm-reset')!);
    fireEvent.click(view.getByText('Generate New World'));
    await Promise.resolve();

    view.unmount();
    expect(SocketStub.instances[0]!.close).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledOnce();
  });
});

describe('generatorUsesSeed', () => {
  it('recognizes explicit metadata and fixed demo generators', () => {
    expect(generatorUsesSeed({ name: 'custom', uses_seed: false })).toBe(false);
    expect(generatorUsesSeed({ name: 'recursive' })).toBe(true);
    expect(generatorUsesSeed({ name: 'tutorial-demo' })).toBe(false);
  });
});
