import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WorldEditorPage,
  type WorldEditorFacade,
  type WorldEditorServices,
} from '../src/world-editor/app';
import type { EditorWorld } from '../src/world-editor/models';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const snapshot: EditorWorld = {
  entities: {
    clock: {
      id: 'clock',
      prefab: 'entity',
      created_epoch: 0,
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
    target: { id: 'target', prefab: 'entity', created_epoch: 0, components: { IdentityComponent: { name: 'Target' } }, relationships: {} },
  },
  meta: { seed: 'test', generator: 'unit', saved_at_epoch: 2 },
  metadata: { version: '1.0', epoch: 2 },
};

const sendJsonMock = vi.fn(async (_base: string, path: string): Promise<unknown> => {
  if (path.endsWith('/snapshot')) return clone(snapshot);
  if (path.endsWith('/runtime')) return { paused: false, running: true, world_epoch: 2 };
  if (path.endsWith('/catalog')) return { components: {}, edges: {} };
  return { changed_entities: [], deleted_entities: [], world_epoch: 2 };
});
const confirmMock = vi.fn(async (): Promise<boolean> => true);
const services: WorldEditorServices = {
  confirmDialog: confirmMock,
  initClientMenu: vi.fn(),
  loadConfig: vi.fn(async (): Promise<unknown> => ({ autoConnect: false, serverUrl: '' })),
  normalizeBase: vi.fn((value: string): string => value.replace(/\/$/, '')),
  sendJson: sendJsonMock,
  serverFromUrl: vi.fn((): string => new URLSearchParams(location.search).get('server') || ''),
};

const pageWindow = (): Window & { app?: WorldEditorFacade } => window as Window & { app?: WorldEditorFacade };
const renderEditor = (liveAuth?: { authorized: boolean; request: () => void }) => render(<WorldEditorPage liveAuth={liveAuth} services={services} />);

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/world-editor.html');
  localStorage.clear();
  sendJsonMock.mockImplementation(async (_base: string, path: string): Promise<unknown> => {
    if (path.endsWith('/snapshot')) return clone(snapshot);
    if (path.endsWith('/runtime')) return { paused: false, running: true, world_epoch: 2 };
    if (path.endsWith('/catalog')) return { components: {}, edges: {} };
    return { changed_entities: [], deleted_entities: [], world_epoch: 2 };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('WorldEditorPage', () => {
  it('keeps offline editing available while requesting admin access for live snapshots', () => {
    const request = vi.fn();
    const view = renderEditor({ authorized: false, request });
    expect(view.container.querySelector('#btn-new')).toBeTruthy();
    expect(view.container.querySelector('#btn-fetch')?.textContent).toBe('Login for Live');
    fireEvent.click(view.container.querySelector('#btn-fetch')!);
    expect(request).toHaveBeenCalledOnce();
    expect(sendJsonMock).not.toHaveBeenCalled();
  });

  it('loads and normalizes pending map links while preserving server query and history focus', async () => {
    window.history.replaceState(null, '', '/world-editor.html?server=%2Fapi#map/target');
    const view = renderEditor();
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
    const view = renderEditor();
    const facade = pageWindow().app!;
    expect(Object.keys(facade)).toEqual(['libraryFragments', 'selectedId', 'world', 'worldSchema', '_renderAll', '_renderEntities', '_renderJson', '_renderLibraryControls']);
    const typedWorld = clone(snapshot);
    facade.world = typedWorld;
    facade.selectedId = 'target';
    facade.libraryFragments = [{ id: 'fragment.one', kind: 'room', operations: [], schema_version: 1, source: 'test', title: 'One' }];
    facade._renderAll();
    await waitFor(() => expect(view.container.querySelector('#selected-label')?.textContent).toBe('target'));
    expect(view.container.querySelector('#fragment-dropdown')).toBeTruthy();
    expect(facade.world).toBe(typedWorld);
    view.unmount();
    expect(pageWindow().app).toBeUndefined();
  });

  it('edits schema-aware scalar and shared tag fields while preserving unknown component fields', async () => {
    const view = renderEditor();
    const facade = pageWindow().app!;
    facade.worldSchema = { components: { TypedComponent: { json_schema: { type: 'object', properties: {
      count: { type: 'integer', minimum: 0 }, tags: { type: 'array', items: { type: 'string' } },
    } } } }, edges: {} };
    facade.world = { metadata: { version: '1.0', epoch: 3 }, meta: {}, entities: { typed: {
      id: 'typed', prefab: 'entity', created_epoch: 0,
      components: { TypedComponent: { count: 1, tags: ['calm'], future: 'keep' }, WorldClockComponent: {} }, relationships: {},
    } } };
    facade.selectedId = 'typed';
    facade._renderAll();
    await waitFor(() => expect(view.container.querySelector('[data-field="count"]')).toBeTruthy());
    fireEvent.input(view.container.querySelector('[data-field="count"]')!, { target: { value: '4' } });
    const tagInput = await waitFor(() => view.container.querySelector<HTMLInputElement>('.tag-input')!);
    fireEvent.input(tagInput, { target: { value: 'brave' } });
    fireEvent.click(view.container.querySelector('[data-add-tag]')!);
    await waitFor(() => expect(view.container.querySelector<HTMLTextAreaElement>('#json-output')?.value).toContain('"count": 4'));
    const text = view.container.querySelector<HTMLTextAreaElement>('#json-output')!.value;
    expect(text).toContain('"brave"');
    expect(text).toContain('"future": "keep"');
  });

  it('clears debounced live patches, menu state, and location listeners during teardown', async () => {
    window.history.replaceState(null, '', '/world-editor.html?server=%2Fapi#target');
    const clearTimeout = vi.spyOn(window, 'clearTimeout');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const close = vi.fn();
    vi.mocked(services.initClientMenu).mockReturnValueOnce({ close });
    const view = renderEditor();
    await waitFor(() => expect(view.container.querySelector('#selected-label')?.textContent).toBe('target'));
    fireEvent.input(view.container.querySelector('.component-json')!, { target: { value: '{"name":"Changed"}' } });
    view.unmount();
    expect(clearTimeout).toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith('hashchange', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('popstate', expect.any(Function));
    expect(close).toHaveBeenCalledOnce();
  });

  it('toggles the snapshot pane and keeps metadata controls in exported JSON', () => {
    const view = renderEditor();
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

  it('edits world details offline and includes them in exported JSON', async () => {
    const view = renderEditor();
    fireEvent.input(view.container.querySelector('#editor-world-title')!, {
      target: { value: 'Clover City' },
    });
    fireEvent.input(view.container.querySelector('#editor-world-description')!, {
      target: { value: 'A cheerful city of gardens.' },
    });
    fireEvent.input(view.container.querySelector('#editor-world-content-flags')!, {
      target: { value: 'pvp, adult:violence, pvp' },
    });
    fireEvent.click(view.container.querySelector('#editor-save-world-details')!);

    await waitFor(() => {
      const text = view.container.querySelector<HTMLTextAreaElement>('#json-output')!.value;
      expect(text).toContain('"title": "Clover City"');
      expect(text).toContain('"description": "A cheerful city of gardens."');
      expect(text).toContain('"adult:violence"');
    });
    expect(view.container.querySelector('#status')?.textContent).toBe('World details updated');
  });

  it('patches the singleton world info component when editing live details', async () => {
    window.history.replaceState(null, '', '/world-editor.html?server=%2Fapi');
    const view = renderEditor();
    await waitFor(() => expect(view.container.querySelector('#status')?.textContent).toContain('live patches enabled'));
    fireEvent.input(view.container.querySelector('#editor-world-title')!, {
      target: { value: 'Live Clover City' },
    });
    fireEvent.click(view.container.querySelector('#editor-save-world-details')!);

    await waitFor(() => expect(sendJsonMock).toHaveBeenCalledWith(
      '/api',
      '/admin/world',
      expect.objectContaining({ method: 'PATCH' }),
    ));
    const patchCall = sendJsonMock.mock.calls.find((call) => call[1] === '/admin/world');
    const init = patchCall?.[2] as RequestInit | undefined;
    expect(JSON.parse(String(init?.body))).toEqual({
      operations: [{
        op: 'set_component',
        entity_id: 'clock',
        component: {
          type: 'WorldInfoComponent',
          fields: {
            content_flags: ['pvp'],
            description: 'A test world.',
            title: 'Live Clover City',
          },
        },
      }],
    });
  });
});
