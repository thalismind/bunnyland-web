import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BehaviorEditorPage, type BehaviorEditorRuntime } from '../src/behavior-editor/page';

interface RuntimeOptions {
  captureConfigConnect?: (connect: (server: string) => void) => void;
  onRegister?: (body: string) => void;
}

function runtime(options: RuntimeOptions = {}): BehaviorEditorRuntime {
  return {
    api: {
      applyConfigToInput: vi.fn(async ({ connect }) => {
        options.captureConfigConnect?.(connect);
        return {};
      }),
      applyServerParam: vi.fn(() => ''),
      normalizeBase: vi.fn(value => value.replace(/\/$/, '')),
      sendAdmin: vi.fn(async (_base, path, request) => {
        if (path.endsWith('/controller-definitions')) {
          return {
            condition_library: ['has_visible_objects', 'is_story_time'],
            action_library: ['move_first_exit', 'say', 'take_first_item', 'wave'],
            behaviors: ['doorway-greeter'],
          };
        }
        options.onRegister?.(request.body || '');
        return { behaviors: ['doorway-greeter', 'local-behavior'] };
      }),
      setServerInUrl: vi.fn(),
    },
    ui: { initClientMenu: vi.fn() },
  };
}

afterEach(cleanup);

describe('BehaviorEditorPage', () => {
  it('edits a keyed tree and validates leaf refs and parameter JSON', () => {
    const view = render(<BehaviorEditorPage runtime={runtime()} />);
    const root = view.container.querySelector('.bt-node[data-path=""]');
    expect(view.container.querySelectorAll('.bt-node')).toHaveLength(5);
    expect(view.getByText('Valid behavior JSON.')).toBeTruthy();

    fireEvent.click(view.container.querySelector('.bt-node[data-path=""] > .bt-head [data-add="action"]')!);
    expect(view.container.querySelectorAll('.bt-node')).toHaveLength(6);
    expect(view.container.querySelector('.bt-node[data-path=""]')).toBe(root);
    expect(view.getByText(/action leaf requires a library ref/)).toBeTruthy();

    fireEvent.change(view.container.querySelector('.bt-node[data-path="2"] .node-ref')!, { target: { value: 'say' } });
    expect(view.getByText(/say requires a non-empty text param/)).toBeTruthy();
    const params = view.container.querySelector('.bt-node[data-path="2"] .node-params')!;
    fireEvent.input(params, { target: { value: '{bad json' } });
    expect(params.classList.contains('bad-json')).toBe(true);
    expect(view.getByText(/invalid params JSON/)).toBeTruthy();
    fireEvent.input(params, { target: { value: '{"text":"hello"}' } });
    expect(view.getByText('Valid behavior JSON.')).toBeTruthy();
  });

  it('switches node kinds, deletes children, and keeps JSON output synchronized', () => {
    const view = render(<BehaviorEditorPage runtime={runtime()} />);
    fireEvent.change(view.container.querySelector('.bt-node[data-path="1"] .node-kind')!, { target: { value: 'selector' } });
    let spec = JSON.parse((view.container.querySelector('#json-output') as HTMLTextAreaElement).value) as {
      root: { children: Array<Record<string, unknown>> };
    };
    expect(spec.root.children[1]).toEqual({ kind: 'selector', children: [] });

    fireEvent.click(view.container.querySelector('.bt-node[data-path="0.1"] > .bt-head .node-delete')!);
    spec = JSON.parse((view.container.querySelector('#json-output') as HTMLTextAreaElement).value) as typeof spec;
    expect((spec.root.children[0]?.children as unknown[])).toHaveLength(1);
  });

  it('loads server libraries and registers the exact current JSON spec', async () => {
    let posted = '';
    const view = render(<BehaviorEditorPage runtime={runtime({ onRegister: body => { posted = body; } })} />);
    fireEvent.input(view.container.querySelector('#api-url')!, { target: { value: '/api' } });
    fireEvent.click(view.container.querySelector('#btn-connect')!);

    await waitFor(() => expect(view.container.querySelector('#api-status')?.textContent).toBe('live'));
    expect(view.container.querySelector('#library-source')?.textContent).toBe('from server');
    expect(view.getByText('is_story_time', { selector: '#condition-list .pill' })).toBeTruthy();
    expect(view.getByText('doorway-greeter')).toBeTruthy();

    fireEvent.click(view.container.querySelector('#btn-register')!);
    await waitFor(() => expect(view.container.querySelector('#save-status')?.textContent).toContain("Registered behavior 'local-behavior'"));
    expect(JSON.parse(posted)).toEqual({
      definition: JSON.parse((view.container.querySelector('#json-output') as HTMLTextAreaElement).value),
    });
    expect(view.getByText('local-behavior', { selector: '.behavior-name-row' })).toBeTruthy();
  });

  it('ignores delayed config callbacks after its root unmounts', async () => {
    let configConnect: ((server: string) => void) | undefined;
    const editorRuntime = runtime({ captureConfigConnect: connect => { configConnect = connect; } });
    const normalizeBase = vi.mocked(editorRuntime.api.normalizeBase);
    const view = render(<BehaviorEditorPage runtime={editorRuntime} />);
    await waitFor(() => expect(configConnect).toBeTypeOf('function'));
    view.unmount();
    configConnect?.('/late-server');
    expect(normalizeBase).not.toHaveBeenCalled();
  });
});
