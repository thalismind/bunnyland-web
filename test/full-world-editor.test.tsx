/* eslint-disable @typescript-eslint/no-explicit-any */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import type { ComponentType } from 'preact';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Json = Record<string, any>;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const snapshot = {
  entities: {
    clock: { id: 'clock', prefab: 'entity', created_epoch: 0, components: { WorldClockComponent: {} }, relationships: {} },
    target: { id: 'target', prefab: 'entity', created_epoch: 0, components: { IdentityComponent: { name: 'Target' } }, relationships: {} },
  },
  meta: { seed: 'test', generator: 'unit', saved_at_epoch: 2 }, metadata: { epoch: 2 },
};
const sendAdmin = vi.fn(async (_base: string, path: string) => path.endsWith('/runtime')
  ? { paused: false, running: true, world_epoch: 2 }
  : clone(snapshot));
const sendJson = vi.fn(async (_base: string, path: string) => path.endsWith('/schema') ? { components: {}, edges: {} } : { fragments: [] });
const bunnylandApi = {
  normalizeBase: vi.fn((value: string) => value.replace(/\/$/, '')),
  sendAdmin,
  sendJson,
  serverFromUrl: vi.fn(() => new URLSearchParams(location.search).get('server') || ''),
};
const bunnylandUi = {
  bindSearchDropdown: vi.fn((root: HTMLElement, { options, value = '' }: Json) => {
    const input = root.querySelector<HTMLInputElement>('.search-dropdown-input')!;
    const hidden = root.querySelector<HTMLInputElement>('.search-dropdown-value')!;
    const selected = options.find((item: Json) => item.value === value);
    hidden.value = selected?.value || ''; input.value = selected?.label || '';
  }),
  cloneJson: clone,
  initClientMenu: vi.fn(),
  loadConfig: vi.fn(async () => ({ autoConnect: false, serverUrl: '' })),
};
function exportWorld(world: Json) {
  const components: Json = {}; const relationships: Json = {};
  for (const entity of Object.values(world.entities || {}) as Json[]) {
    for (const [type, fields] of Object.entries(entity.components || {})) { components[type] ??= {}; components[type][entity.id] = fields; }
    for (const [type, edges] of Object.entries(entity.relationships || {})) { relationships[type] ??= {}; relationships[type][entity.id] = edges; }
  }
  return { bunnyland: world.meta || {}, components, entities: world.entities || {}, metadata: world.metadata || {}, relationships };
}
const bunnylandWorld = {
  componentNames: vi.fn((world: Json, common: string[]) => [...new Set([...common, ...Object.values(world.entities || {}).flatMap((entity: any) => Object.keys(entity.components || {}))])]),
  edgeNames: vi.fn((_world: Json, common: string[]) => common),
  entityDisplayName: vi.fn((entity: Json) => entity.components?.IdentityComponent?.name || entity.id),
  entityIcon: vi.fn(() => '◇'),
  entityType: vi.fn(() => 'entity'),
  exportWorld,
  parseApiEntity: vi.fn((value: Json) => ({ ...value, relationships: value.relationships || {} })),
  parseEntitySearch: vi.fn((query: string) => ({ filters: [], invalid: query === 'invalid', text: query === 'invalid' ? '' : query.toLowerCase() })),
  parseWorld: vi.fn((value: Json) => clone(value)),
};

type Facade = {
  libraryFragments: Json[]; selectedId: string; world: Json; worldSchema: Json | null;
  _renderAll(): void; _renderEntities(): void; _renderJson(): void; _renderLibraryControls(): void;
};
let WorldEditorPage: ComponentType;

beforeAll(async () => {
  vi.stubGlobal('BunnylandApi', bunnylandApi);
  vi.stubGlobal('BunnylandUI', bunnylandUi);
  vi.stubGlobal('BunnylandWorld', bunnylandWorld);
  ({ WorldEditorPage } = await import('../src/world-editor/app'));
});
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/world-editor.html');
  localStorage.clear();
  sendAdmin.mockImplementation(async (_base: string, path: string) => path.endsWith('/runtime')
    ? { paused: false, running: true, world_epoch: 2 }
    : clone(snapshot));
  sendJson.mockImplementation(async (_base: string, path: string) => path.endsWith('/schema') ? { components: {}, edges: {} } : { fragments: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
afterAll(() => vi.unstubAllGlobals());

const pageWindow = () => window as unknown as { app?: Facade };

describe('WorldEditorPage', () => {
  it('keeps offline editing available while requesting admin access for live snapshots', () => {
    const request = vi.fn();
    const view = render(<WorldEditorPage liveAuth={{ authorized: false, request }} />);
    expect(view.container.querySelector('#btn-new')).toBeTruthy();
    expect(view.container.querySelector('#btn-fetch')?.textContent).toBe('Login for Live');
    fireEvent.click(view.container.querySelector('#btn-fetch')!);
    expect(request).toHaveBeenCalledOnce();
    expect(sendAdmin).not.toHaveBeenCalled();
  });

  it('loads and normalizes pending map links while preserving server query and history focus', async () => {
    window.history.replaceState(null, '', '/world-editor.html?server=%2Fapi#map/target');
    const view = render(<WorldEditorPage />);
    await waitFor(() => expect(view.container.querySelector('#selected-label')?.textContent).toBe('target'));
    expect(location.search).toBe('?server=%2Fapi');
    expect(location.hash).toBe('#target');
    expect(view.container.querySelector<HTMLAnchorElement>('#inspector-link')?.href).toContain('inspector.html?server=%2Fapi#map/target');

    window.history.replaceState(null, '', '/world-editor.html?server=%2Fapi#clock');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(view.container.querySelector('#selected-label')?.textContent).toBe('clock'));
    window.history.replaceState(null, '', '/world-editor.html?server=%2Fapi#target');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(view.container.querySelector('#selected-label')?.textContent).toBe('target'));
  });

  it('exposes only the required delegated facade and deletes it on unmount', async () => {
    const view = render(<WorldEditorPage />); const facade = pageWindow().app!;
    expect(Object.keys(facade)).toEqual(['libraryFragments', 'selectedId', 'world', 'worldSchema', '_renderAll', '_renderEntities', '_renderJson', '_renderLibraryControls']);
    const typedWorld = clone(snapshot); facade.world = typedWorld; facade.selectedId = 'target';
    facade.libraryFragments = [{ id: 'fragment.one', kind: 'room', operations: [], title: 'One' }];
    facade._renderAll();
    await waitFor(() => expect(view.container.querySelector('#selected-label')?.textContent).toBe('target'));
    expect(view.container.querySelector('#fragment-dropdown')).toBeTruthy();
    expect(facade.world).toBe(typedWorld);
    view.unmount();
    expect(pageWindow().app).toBeUndefined();
  });

  it('edits schema-aware scalar and list fields while preserving unknown component fields', async () => {
    const view = render(<WorldEditorPage />); const facade = pageWindow().app!;
    facade.worldSchema = { components: { TypedComponent: { json_schema: { type: 'object', properties: {
      count: { type: 'integer', minimum: 0 }, tags: { type: 'array', items: { type: 'string' } },
    } } } }, edges: {} };
    facade.world = { metadata: { epoch: 3 }, entities: { typed: {
      id: 'typed', components: { TypedComponent: { count: 1, tags: ['calm'], future: 'keep' }, WorldClockComponent: {} }, relationships: {},
    } } };
    facade.selectedId = 'typed'; facade._renderAll();
    await waitFor(() => expect(view.container.querySelector('[data-field="count"]')).toBeTruthy());
    fireEvent.input(view.container.querySelector('[data-field="count"]')!, { target: { value: '4' } });
    fireEvent.input(view.container.querySelector('.tag-input')!, { target: { value: 'brave' } });
    fireEvent.click(view.container.querySelector('[data-add-tag]')!);
    await waitFor(() => expect(view.container.querySelector<HTMLTextAreaElement>('#json-output')?.value).toContain('"count": 4'));
    const text = view.container.querySelector<HTMLTextAreaElement>('#json-output')!.value;
    expect(text).toContain('"brave"');
    expect(text).toContain('"future": "keep"');
  });

  it('clears debounced live patches and location listeners during teardown', async () => {
    window.history.replaceState(null, '', '/world-editor.html?server=%2Fapi#target');
    const clearTimeout = vi.spyOn(window, 'clearTimeout');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const view = render(<WorldEditorPage />);
    await waitFor(() => expect(view.container.querySelector('#selected-label')?.textContent).toBe('target'));
    fireEvent.input(view.container.querySelector('.component-json')!, { target: { value: '{"name":"Changed"}' } });
    view.unmount();
    expect(clearTimeout).toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith('hashchange', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('popstate', expect.any(Function));
  });

  it('toggles the snapshot pane and keeps metadata controls in exported JSON', () => {
    const view = render(<WorldEditorPage />);
    fireEvent.click(view.container.querySelector('#btn-toggle-snapshot')!);
    expect(view.container.querySelector('#main')?.classList.contains('snapshot-hidden')).toBe(true);
    expect(view.container.querySelector('#btn-toggle-snapshot')?.textContent).toBe('Show Snapshot');
    fireEvent.input(view.container.querySelector('#meta-seed')!, { target: { value: 'toolbar-seed' } });
    fireEvent.input(view.container.querySelector('#meta-generator')!, { target: { value: 'toolbar-generator' } });
    fireEvent.input(view.container.querySelector('#meta-epoch')!, { target: { value: '42' } });
    const text = view.container.querySelector<HTMLTextAreaElement>('#json-output')!.value;
    expect(text).toContain('"seed": "toolbar-seed"');
    expect(text).toContain('"generator": "toolbar-generator"');
    expect(text).toContain('"epoch": 42');
  });
});
