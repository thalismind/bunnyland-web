import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScriptEditorPage, normalizeScript, validateScript } from '../src/script-editor/app';
import { expectNoSeriousAxeIssues } from './axe';

const initClientMenu = vi.fn();
const promptDialog = vi.fn(async () => null);
const confirmDialog = vi.fn(async () => true);
const world = {
  controlInfo: vi.fn(() => null),
  entityDisplayName: vi.fn((entity: { components: Record<string, { name?: string }>; id: string }) =>
    entity.components.IdentityComponent?.name ?? entity.id),
  entityIcon: vi.fn(() => 'C'),
  entityType: vi.fn(() => 'character'),
  parseSnapshot: vi.fn(() => ({
    entities: {
      'entity_juniper': {
        components: {
          CharacterComponent: { species: 'bunny' },
          IdentityComponent: { kind: 'character', name: 'Juniper' },
        },
        id: 'entity_juniper',
      },
    },
    epoch: 7,
    meta: { generator: 'test', seed: 'meadow' },
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('BunnylandUI', { confirmDialog, initClientMenu, promptDialog });
  vi.stubGlobal('BunnylandWorld', world);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ScriptEditorPage', () => {
  it('retains the keyed block row while editing its fields', () => {
    const view = render(<ScriptEditorPage />);
    fireEvent.click(view.getByText('Add Block'));
    const original = view.container.querySelector('[data-index="0"]');
    fireEvent.input(view.container.querySelector('#block-name')!, { target: { value: 'greet-juniper' } });
    fireEvent.input(view.container.querySelector('#block-priority')!, { target: { value: '3' } });

    expect(view.container.querySelector('[data-index="0"]')).toBe(original);
    expect(original?.textContent).toContain('greet-juniper');
    expect(view.container.querySelector<HTMLTextAreaElement>('#json-output')?.value).toContain('"priority": 3');
  });

  it('marks invalid action JSON without losing it and reports semantic validation', () => {
    const view = render(<ScriptEditorPage />);
    fireEvent.click(view.getByText('Add Block'));
    fireEvent.click(view.getByText('Add submit_command'));
    const query = view.container.querySelector<HTMLTextAreaElement>('.target-query')!;
    fireEvent.input(query, { target: { value: '{bad' } });
    expect(query.classList.contains('bad-json')).toBe(true);
    expect(query.value).toBe('{bad');
    fireEvent.input(query, { target: { value: '{"id":"juniper"}' } });
    expect(query.classList.contains('bad-json')).toBe(false);
    fireEvent.input(view.container.querySelector('.command-type')!, { target: { value: '' } });
    expect(view.container.querySelector('#problems')?.textContent).toContain('requires command_type');
    fireEvent.click(view.getByText('Add patch_world'));
    const operations = view.container.querySelector<HTMLTextAreaElement>('.action-ops')!;
    fireEvent.input(operations, { target: { value: '{bad' } });
    expect(operations.classList.contains('bad-json')).toBe(true);
  });

  it('loads a snapshot and applies the selected entity to the first submit action', async () => {
    const view = render(<ScriptEditorPage />);
    fireEvent.click(view.getByText('Add Block'));
    fireEvent.click(view.getByText('Add submit_command'));
    const file = new File(['{}'], 'world.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: vi.fn(async () => '{}') });
    fireEvent.change(view.container.querySelector('#snapshot-input')!, { target: { files: [file] } });
    await waitFor(() => expect(view.getByText('Snapshot loaded')).toBeTruthy());
    fireEvent.input(view.container.querySelector('#entity-search')!, { target: { value: 'Juniper' } });
    fireEvent.click(view.container.querySelector('[data-id="entity_juniper"]')!);
    fireEvent.click(view.container.querySelector('[data-use="id"]')!);

    expect(view.getByText('Target query updated')).toBeTruthy();
    expect(view.container.querySelector<HTMLTextAreaElement>('.target-query')?.value).toContain('entity_juniper');
    await expectNoSeriousAxeIssues(view.container);
  });

  it('revokes the temporary object URL after downloading JSON', () => {
    const createObjectURL = vi.fn(() => 'blob:script-json');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const view = render(<ScriptEditorPage />);
    fireEvent.click(view.getByText('Download JSON'));

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:script-json');
    expect(view.getByText('JSON downloaded')).toBeTruthy();
  });

  it('guards New and browser unload while script changes are unsaved', async () => {
    confirmDialog.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const view = render(<ScriptEditorPage />);
    fireEvent.click(view.getByText('Add Block'));
    expect(view.container.querySelectorAll('.block-row')).toHaveLength(1);
    const unload = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(unload)).toBe(false);

    fireEvent.click(view.container.querySelector('#btn-new')!);
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledOnce());
    expect(view.container.querySelectorAll('.block-row')).toHaveLength(1);
    fireEvent.click(view.container.querySelector('#btn-new')!);
    await waitFor(() => expect(view.container.querySelectorAll('.block-row')).toHaveLength(0));
    expect(view.container.querySelector('#dirty-status')).toBeNull();
  });

  it('guards script file replacement and permits retrying the same file after Cancel', async () => {
    confirmDialog.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const view = render(<ScriptEditorPage />);
    fireEvent.click(view.getByText('Add Block'));
    const file = new File(['{}'], 'replacement.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: vi.fn(async () => JSON.stringify({ id: 'loaded-script' })) });
    const input = view.container.querySelector<HTMLInputElement>('#script-input')!;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledOnce());
    expect((view.container.querySelector('#script-id') as HTMLInputElement).value).toBe('local.script');
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect((view.container.querySelector('#script-id') as HTMLInputElement).value).toBe('loaded-script'));
  });
});

describe('script normalization and validation', () => {
  it('normalizes loaded blocks and detects duplicate names', () => {
    const script = normalizeScript({ blocks: [
      { actions: [], name: 'same', trigger: { tick: true } },
      { actions: [], name: 'same', trigger: { tick: true } },
    ] });
    expect(validateScript(script)).toContain('duplicate block name: same');
  });
});
