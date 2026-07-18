/* eslint-disable @typescript-eslint/no-explicit-any */
import { cleanup, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InspectorApp, type InspectorFacade } from '../src/inspector/app';

class FakeNode {
  entityId?: string;
  inputs = [{}];
  outputs = [{ links: [] as number[] }];
  pos = [0, 0];
  size = [240, 60];
  widgets: any[] = [];
  addInput() {}
  addOutput() {}
  addWidget(type: string, name: string, value: any, callback: () => void) {
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
  selected_nodes: Record<string, FakeNode> = {};
  constructor(canvas: HTMLCanvasElement, graph: FakeGraph) { this.canvas = canvas; void graph; }
  getCanvasMenuOptions = () => null;
  getNodeMenuOptions = () => null;
  resize() {}
  selectNode(node: FakeNode) { this.selected_nodes = { selected: node }; }
  setDirty() {}
  stopRendering() {}
}

function entityType(entity: any): string {
  if (entity.components.RoomComponent) return 'room';
  if (entity.components.CharacterComponent) return 'character';
  if (entity.components.RegionComponent) return 'region';
  return 'other';
}

function makeWorld(epoch = 1, includeSecond = false): any {
  return {
    entities: {
      room: {
        id: 'room',
        components: { NameComponent: { name: 'Parlor' }, RoomComponent: { indoor: true } },
        relationships: { Contains: [{ edge: {}, target: 'character' }], ExitTo: includeSecond ? [{ edge: { direction: 'east' }, target: 'room:two' }] : [] },
      },
      character: {
        id: 'character',
        components: { CharacterComponent: { species: 'hare' }, NameComponent: { name: 'Hazel' } },
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

const closeMenu = vi.fn();

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
      initClientMenu: () => ({ close: closeMenu }),
      loadConfig: async () => ({}),
    },
    BunnylandWorld: {
      controlInfo: () => null,
      controllerInfo: () => null,
      entityDisplayName: (entity: any) => entity.components.NameComponent?.name || entity.id,
      entityType,
      parseApiSnapshot: (value: any) => value,
      parseEntitySearch: (query: string) => ({ filters: [], text: query.toLowerCase() }),
      parseSnapshot: (value: any) => value,
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
    expect(sendAdmin).toHaveBeenCalledWith('/admin/controllers/assign', expect.objectContaining({
      body: JSON.stringify({ character_id: 'character', controller_id: 'controller' }), method: 'POST',
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

  it('applies hash navigation without reconnecting or replacing the server query', async () => {
    history.replaceState(null, '', '/inspector.html?server=%2Fapi#region/character');
    const view = render(<InspectorApp/>);
    await waitFor(() => expect(facade()).toBeTruthy());
    facade()!._applyWorld(makeWorld(), { resetView: true });
    const canvas = facade()!.lgcanvas;
    canvas.ds.scale = 1.4;
    canvas.ds.offset = [7, 12];
    (window.BunnylandApi as any).sendAdmin.mockClear();

    history.pushState(null, '', '/inspector.html?server=%2Fapi#map/room');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(view.container.querySelector('#inspector-name')?.textContent).toContain('Parlor'));
    expect(location.search).toBe('?server=%2Fapi');
    expect(canvas.ds).toEqual({ offset: [7, 12], scale: 1.4 });
    expect((window.BunnylandApi as any).sendAdmin).not.toHaveBeenCalled();
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
