import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InspectorApp, type InspectorFacade } from '../src/inspector/app';

type InspectorEntity = NonNullable<InspectorFacade['world']>['entities'][string];
type InspectorWorld = NonNullable<InspectorFacade['world']>;
type SendAdminOptions = NonNullable<Parameters<InspectorFacade['_sendAdmin']>[1]>;

interface FakeWidget {
  callback: () => void;
  name: string;
  type: string;
  value: unknown;
}

class FakeNode {
  entityId?: string;
  inputs = [{}];
  outputs = [{ links: [] as number[] }];
  pos = [0, 0];
  size = [240, 60];
  widgets: FakeWidget[] = [];
  addInput() {}
  addOutput() {}
  addWidget(type: string, name: string, value: unknown, callback: () => void) {
    const widget = { callback, name, type, value };
    this.widgets.push(widget);
    return widget;
  }
  connect(_output: number, target: FakeNode) {
    this.outputs[0]!.links.push(1);
    return { target };
  }
  disconnectInput() {}
  disconnectOutput() { this.outputs[0]!.links = []; }
}

class FakeGraph {
  _nodes: FakeNode[] = [];
  links: Record<string, unknown> = {};
  add(node: FakeNode) { if (!this._nodes.includes(node)) this._nodes.push(node); }
  clear() { this._nodes = []; }
  remove(node: FakeNode) { this._nodes = this._nodes.filter((item) => item !== node); }
}

class FakeCanvas {
  canvas: HTMLCanvasElement;
  ds = { offset: [0, 0], scale: 1 };
  onNodeSelected = () => undefined;
  selected_nodes: Record<string, FakeNode> = {};
  constructor(canvas: HTMLCanvasElement, graph: FakeGraph) { this.canvas = canvas; void graph; }
  getCanvasMenuOptions = () => null;
  getNodeMenuOptions = () => null;
  resize() {}
  selectNode(node: FakeNode) { this.selected_nodes = { selected: node }; this.onNodeSelected(node); }
  setDirty() {}
  stopRendering() {}
}

function entityType(entity: InspectorEntity): string {
  if (entity.components.RoomComponent) return 'room';
  if (entity.components.CharacterComponent) return 'character';
  if (entity.components.RegionComponent) return 'region';
  return 'other';
}

function makeWorld(epoch = 1, includeSecond = false): InspectorWorld {
  return {
    entities: {
      room: {
        id: 'room',
        components: { NameComponent: { name: 'Parlor' }, RoomComponent: { indoor: true } },
        relationships: { Contains: [{ edge: {}, target: 'character' }, { edge: {}, target: 'door' }], ExitTo: includeSecond ? [{ edge: { direction: 'east' }, target: 'room:two' }] : [] },
      },
      door: {
        id: 'door',
        components: { DoorComponent: { open: false }, NameComponent: { name: 'East Door' } },
        relationships: {},
      },
      character: {
        id: 'character',
        components: { CharacterComponent: { species: 'hare' }, NameComponent: { name: 'Hazel' } },
        relationships: {},
      },
      clock: {
        id: 'clock',
        components: {
          WorldClockComponent: {},
          WorldInfoComponent: {
            content_flags: ['pvp'],
            description: 'A test world.',
            title: 'Test World',
          },
        },
        relationships: {},
      },
      ...(includeSecond ? {
        'room:two': { id: 'room:two', components: { NameComponent: { name: 'Garden' }, RoomComponent: {} }, relationships: { ExitTo: [] } },
      } : {}),
    },
    epoch,
    meta: { seed: 'test' },
  };
}

function facade(): InspectorFacade | undefined {
  return (window as unknown as { app?: InspectorFacade }).app;
}

function sendAdminMock(): ReturnType<typeof vi.fn> {
  return (window as unknown as {
    BunnylandApi: { sendAdmin: ReturnType<typeof vi.fn> };
  }).BunnylandApi.sendAdmin;
}

const closeMenu = vi.fn();
const confirmDialog = vi.fn(async () => true);
const promptDialog = vi.fn<() => Promise<string | null>>();

beforeEach(() => {
  history.replaceState(null, '', '/inspector.html');
  Object.assign(window, {
    BunnylandApi: {
      assertSameOriginBase: (value: string) => value,
      normalizeBase: (value: string) => value,
      sendAdmin: vi.fn(async () => ({})),
      serverFromUrl: () => new URL(location.href).searchParams.get('server') || '',
      socketUrl: () => 'ws://localhost/updates',
    },
    BunnylandEvents: { eventSummary: () => 'event', icon: () => '⚡' },
    BunnylandUI: {
      cloneJson: (value: unknown) => structuredClone(value),
      confirmDialog,
      initClientMenu: () => ({ close: closeMenu }),
      loadConfig: async () => ({}),
      promptDialog,
    },
    BunnylandWorld: {
      controlInfo: () => null,
      controllerInfo: () => null,
      entityDisplayName: (entity: InspectorEntity) => entity.components.NameComponent?.name || entity.id,
      entityType,
      parseApiSnapshot: (value: unknown) => value as InspectorWorld,
      parseEntitySearch: (query: string) => ({ filters: [], text: query.toLowerCase() }),
      parseSnapshot: (value: unknown) => value as InspectorWorld,
    },
    LGraph: FakeGraph,
    LGraphCanvas: FakeCanvas,
    LGraphNode: FakeNode,
    LiteGraph: {
      createNode: () => new FakeNode(),
      registerNodeType: vi.fn(),
    },
  });
});

afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/inspector.html');
  closeMenu.mockClear();
  vi.unstubAllGlobals();
});

describe('full Inspector page', () => {
  it('owns the complete UI and exposes only the browser compatibility facade', async () => {
    const view = render(<InspectorApp/>);
    await waitFor(() => expect(facade()?.lgraph).toBeInstanceOf(FakeGraph));
    facade()!.loadSnapshot(makeWorld());
    facade()!.selectEntity('character');
    await waitFor(() => expect(view.container.querySelector('#inspector-name')?.textContent).toContain('Hazel'));
    expect(view.container.querySelector('#toolbar')).toBeTruthy();
    expect(view.container.querySelector('#graph-canvas')).toBeTruthy();
    expect(facade()!._nodeMap.room).toBeTruthy();
    expect(Object.getOwnPropertyDescriptor(facade(), 'loadSnapshot')?.writable).toBe(false);
    expect(Object.getOwnPropertyDescriptor(facade(), '_sendAdmin')?.set).toBeTypeOf('function');

    const sendAdmin = vi.fn(async () => ({ changed_entities: [], deleted_entities: [] }));
    facade()!._sendAdmin = sendAdmin;
    await facade()!._assignController('character', 'controller');
    expect(sendAdmin).toHaveBeenCalledWith('/admin/characters/character/controller', expect.objectContaining({
      body: JSON.stringify({ controller_id: 'controller' }), method: 'PUT',
    }));

    view.unmount();
    expect(facade()).toBeUndefined();
    expect(closeMenu).toHaveBeenCalledOnce();
  });

  it('reconciles routine updates without moving existing nodes or resetting canvas state', async () => {
    const view = render(<InspectorApp/>);
    await waitFor(() => expect(facade()?.lgcanvas).toBeInstanceOf(FakeCanvas));
    facade()!.loadSnapshot(makeWorld());
    const roomNode = facade()!._nodeMap.room;
    roomNode.pos = [411, 287];
    facade()!.lgcanvas.ds.scale = 1.75;
    facade()!.lgcanvas.ds.offset = [31, -19];
    facade()!.selectEntity('room');

    facade()!._applyWorld(makeWorld(2, true), { resetView: false });

    expect(facade()!._nodeMap.room).toBe(roomNode);
    expect(roomNode.pos).toEqual([411, 287]);
    expect(facade()!.lgcanvas.ds).toEqual({ offset: [31, -19], scale: 1.75 });
    expect(facade()!.lgcanvas.selected_nodes.selected).toBe(roomNode);
    expect(facade()!._nodeMap['room:two']).toBeTruthy();
    view.unmount();
  });

  it('generates and applies scoped LLM patches from graph actions', async () => {
    const view = render(<InspectorApp/>);
    await waitFor(() => expect(facade()).toBeTruthy());
    facade()!.loadSnapshot(makeWorld());
    facade()!._apiBase = '/api/v1';
    const sendAdmin = vi.fn(async (_path: string, options: SendAdminOptions) => {
      const body = JSON.parse(String(options.body));
      return { result: { patch: { operations: [{ op: 'add_entity', client_id: `$generated_${body.kind}`, components: [] }] } } };
    });
    const sendPatch = vi.fn(async () => ({ changed_entities: [], deleted_entities: [] }));
    facade()!._sendAdmin = sendAdmin;
    facade()!._sendPatch = sendPatch;
    promptDialog
      .mockResolvedValueOnce('a mysterious traveler')
      .mockResolvedValueOnce('a silver key')
      .mockResolvedValueOnce('door')
      .mockResolvedValueOnce('east')
      .mockResolvedValueOnce('a rain-soaked library');

    facade()!._showContextMenu('room', 100, 100);
    await waitFor(() => expect(view.container.querySelector('[data-menu-action="generate-character"]')).toBeTruthy());
    fireEvent.click(view.container.querySelector('[data-menu-action="generate-character"]')!);
    await waitFor(() => expect(sendPatch).toHaveBeenCalledTimes(1));

    facade()!._showContextMenu('room', 100, 100);
    await waitFor(() => expect(view.container.querySelector('[data-menu-action="generate-item"]')).toBeTruthy());
    fireEvent.click(view.container.querySelector('[data-menu-action="generate-item"]')!);
    await waitFor(() => expect(sendPatch).toHaveBeenCalledTimes(2));

    await waitFor(() => expect(view.container.querySelector<HTMLButtonElement>('#btn-generate-room')?.disabled).toBe(false));
    fireEvent.click(view.container.querySelector('#btn-generate-room')!);
    await waitFor(() => expect(sendPatch).toHaveBeenCalledTimes(3));

    expect(sendAdmin.mock.calls.map((call) => [call[0], JSON.parse(call[1].body)])).toEqual([
      ['/admin/world/generation-jobs', { kind: 'character', prompt: 'a mysterious traveler', room_entity_id: 'room' }],
      ['/admin/world/generation-jobs', { container_entity_id: 'room', kind: 'item', prompt: 'a silver key' }],
      ['/admin/world/generation-jobs', { direction: 'east', door_entity_id: 'door', kind: 'room', prompt: 'a rain-soaked library' }],
    ]);
    expect(sendPatch.mock.calls.map((call) => call[0][0].client_id)).toEqual([
      '$generated_character', '$generated_item', '$generated_room',
    ]);
    view.unmount();
  });

  it('edits world title, description, and content flags through a world info patch', async () => {
    const view = render(<InspectorApp/>);
    await waitFor(() => expect(facade()).toBeTruthy());
    facade()!.loadSnapshot(makeWorld());
    facade()!._apiBase = '/api/v1';
    const sendPatch = vi.fn(async () => ({ changed_entities: [], deleted_entities: [] }));
    facade()!._sendPatch = sendPatch;

    await waitFor(() => expect(
      view.container.querySelector<HTMLInputElement>('#inspector-world-title')?.value,
    ).toBe('Test World'));
    fireEvent.input(view.container.querySelector('#inspector-world-title')!, {
      target: { value: 'Clover City' },
    });
    fireEvent.input(view.container.querySelector('#inspector-world-description')!, {
      target: { value: 'Paths leave the meadow in every direction.' },
    });
    fireEvent.input(view.container.querySelector('#inspector-world-content-flags')!, {
      target: { value: 'adult:violence, pvp' },
    });
    fireEvent.click(view.container.querySelector('#inspector-save-world-details')!);

    await waitFor(() => expect(sendPatch).toHaveBeenCalledWith([{
      op: 'set_component',
      entity_id: 'clock',
      component: {
        type: 'WorldInfoComponent',
        fields: {
          content_flags: ['adult:violence', 'pvp'],
          description: 'Paths leave the meadow in every direction.',
          title: 'Clover City',
        },
      },
    }], { status: '● World details saved' }));
    view.unmount();
  });

  it('applies hash navigation without reconnecting or replacing the server query', async () => {
    history.replaceState(null, '', '/inspector.html?server=%2Fapi#region/character');
    const view = render(<InspectorApp/>);
    await waitFor(() => expect(facade()).toBeTruthy());
    facade()!._applyWorld(makeWorld(), { resetView: true });
    const canvas = facade()!.lgcanvas;
    canvas.ds.scale = 1.4;
    canvas.ds.offset = [7, 12];
    sendAdminMock().mockClear();

    history.pushState(null, '', '/inspector.html?server=%2Fapi#map/room');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(view.container.querySelector('#inspector-name')?.textContent).toContain('Parlor'));
    expect(location.search).toBe('?server=%2Fapi');
    expect(canvas.ds).toEqual({ offset: [7, 12], scale: 1.4 });
    expect(sendAdminMock()).not.toHaveBeenCalled();
    view.unmount();
  });

  it('clears the active socket before a synchronous close callback', async () => {
    let closeCalls = 0;
    let socketCount = 0;
    class SynchronousCloseSocket {
      onclose: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;
      constructor() { socketCount += 1; }
      close() { closeCalls += 1; this.onclose?.(new Event('close')); }
      send() {}
    }
    vi.stubGlobal('WebSocket', SynchronousCloseSocket);
    history.replaceState(null, '', '/inspector.html?server=%2Fapi');
    const view = render(<InspectorApp/>);
    await waitFor(() => expect(socketCount).toBe(1));

    facade()!.loadSnapshot(makeWorld());

    expect(closeCalls).toBe(1);
    view.unmount();
  });
});
