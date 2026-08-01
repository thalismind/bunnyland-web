import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CharacterMemoryPage,
  DocumentList,
  type CharacterMemoryServices,
  type MemoryDocument,
} from '../src/character-memory/app';
import { expectNoSeriousAxeIssues } from './axe';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const DOCUMENT: MemoryDocument = {
  document: 'Berries grow north.',
  id: 'memory:one',
  metadata: { source: 'note', tags: ['forage'] },
};

function services(sendAdmin: CharacterMemoryServices['sendAdmin']): CharacterMemoryServices {
  return {
    applyConfig: vi.fn(async () => ({})),
    initClientMenu: vi.fn(() => undefined),
    normalizeBase: (url) => url.replace(/\/$/, ''),
    sendAdmin,
    serverFromUrl: () => '',
    setServerInUrl: vi.fn(),
  };
}

async function openDocument(view: ReturnType<typeof render>): Promise<HTMLTextAreaElement> {
  fireEvent.click(view.container.querySelector('#btn-connect')!);
  await waitFor(() => expect(view.container.querySelector('[data-collection="memory-hazel"]')).toBeTruthy());
  fireEvent.click(view.container.querySelector('[data-collection="memory-hazel"]')!);
  await waitFor(() => expect(view.container.querySelector('[data-document="memory:one"]')).toBeTruthy());
  fireEvent.click(view.container.querySelector('[data-document="memory:one"]')!);
  return view.container.querySelector('#document-text') as HTMLTextAreaElement;
}

describe('full Character Memory page', () => {
  it('keeps document rows keyed while their selection changes', () => {
    const onSelect = vi.fn();
    const view = render(<DocumentList
      collection="memory-hazel"
      documents={[DOCUMENT]}
      onSelect={onSelect}
      selectedId=""
    />);
    const original = view.container.querySelector('[data-document="memory:one"]');
    view.rerender(<DocumentList
      collection="memory-hazel"
      documents={[{ ...DOCUMENT, document: 'Berries grow south.' }]}
      onSelect={onSelect}
      selectedId="memory:one"
    />);
    const updated = view.container.querySelector('[data-document="memory:one"]');
    expect(updated).toBe(original);
    expect(updated?.classList.contains('active')).toBe(true);
    expect(updated?.textContent).toContain('Berries grow south.');
  });

  it('preserves the focused editor and its draft across unrelated filtering updates', async () => {
    const sendAdmin = vi.fn(async (_base: string, path: string) => {
      if (path.endsWith('/memory/collections')) return {
        characters: [{
          character_id: 'character:hazel', name: 'Hazel', private_collection: 'memory-hazel',
        }],
      };
      return { documents: [DOCUMENT] };
    });
    const view = render(<CharacterMemoryPage services={services(sendAdmin)} />);
    const editor = await openDocument(view);
    editor.focus();
    fireEvent.input(editor, { target: { value: 'A focused draft.' } });
    const search = view.container.querySelector('#memory-search') as HTMLInputElement;
    fireEvent.input(search, { target: { value: 'memory' } });
    const updated = view.container.querySelector('#document-text') as HTMLTextAreaElement;
    expect(updated).toBe(editor);
    expect(updated.value).toBe('A focused draft.');
    expect(document.activeElement).toBe(editor);
  });

  it('does not steal focus when a new-document user moves to metadata', async () => {
    let scheduledFocus: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      scheduledFocus = callback;
      return 1;
    });
    const sendAdmin = vi.fn(async (_base: string, path: string) => {
      if (path.endsWith('/memory/collections')) return {
        characters: [{
          character_id: 'character:hazel', name: 'Hazel', private_collection: 'memory-hazel',
        }],
      };
      return { documents: [DOCUMENT] };
    });
    const view = render(<CharacterMemoryPage services={services(sendAdmin)} />);
    await openDocument(view);
    const newButton = view.container.querySelector('#btn-new-document') as HTMLButtonElement;
    newButton.focus();
    fireEvent.click(newButton);
    const metadata = view.container.querySelector('#metadata-json') as HTMLTextAreaElement;
    metadata.focus();
    scheduledFocus?.(0);
    expect(document.activeElement).toBe(metadata);
  });

  it('patches the selected document through the admin API', async () => {
    const sendAdmin = vi.fn(async (_base: string, path: string, options = {}) => {
      if (path.endsWith('/memory/collections')) return {
        characters: [{
          character_id: 'character:hazel', name: 'Hazel', private_collection: 'memory-hazel',
        }],
      };
      if (options.method === 'PATCH') return {
        document: { ...DOCUMENT, document: 'Updated memory.' },
      };
      return { documents: [DOCUMENT] };
    });
    const view = render(<CharacterMemoryPage services={services(sendAdmin)} />);
    const editor = await openDocument(view);
    fireEvent.input(editor, { target: { value: 'Updated memory.' } });
    fireEvent.click(view.container.querySelector('#btn-save-document')!);
    await waitFor(() => expect(sendAdmin).toHaveBeenCalledWith(
      '/api/v1',
      '/admin/memory/collections/memory-hazel/documents/memory%3Aone',
      expect.objectContaining({ method: 'PATCH' }),
    ));
    const call = sendAdmin.mock.calls.find((entry) => entry[2]?.method === 'PATCH');
    expect(JSON.parse(String(call?.[2]?.body))).toEqual({
      document: 'Updated memory.',
      metadata: { source: 'note', tags: ['forage'] },
    });
    await waitFor(() => expect(view.container.querySelector('#editor-status')?.textContent).toBe('Ready.'));
    await expectNoSeriousAxeIssues(view.container);
  });

  it('invalidates pending requests and closes the client menu on unmount', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    const pending = new Promise((resolve) => { resolveRequest = resolve; });
    const close = vi.fn();
    const runtime = services(vi.fn(() => pending));
    runtime.serverFromUrl = () => '/api';
    runtime.initClientMenu = () => ({ close });
    const view = render(<CharacterMemoryPage services={runtime} />);
    await waitFor(() => expect(runtime.sendAdmin).toHaveBeenCalled());
    view.unmount();
    resolveRequest?.({ characters: [{ character_id: 'late', name: 'Late' }] });
    await pending;
    expect(close).toHaveBeenCalledOnce();
  });

  it('guards disconnect and browser unload while a memory draft is dirty', async () => {
    const confirmDialog = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    vi.stubGlobal('BunnylandUI', { confirmDialog });
    const sendAdmin = vi.fn(async (_base: string, path: string) => {
      if (path.endsWith('/memory/collections')) return {
        characters: [{ character_id: 'character:hazel', name: 'Hazel', private_collection: 'memory-hazel' }],
      };
      return { documents: [DOCUMENT] };
    });
    const view = render(<CharacterMemoryPage services={services(sendAdmin)} />);
    const editor = await openDocument(view);
    fireEvent.input(editor, { target: { value: 'Unsaved draft.' } });
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);

    fireEvent.click(view.container.querySelector('#btn-connect')!);
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledOnce());
    expect((view.container.querySelector('#document-text') as HTMLTextAreaElement).value).toBe('Unsaved draft.');
    expect(view.container.querySelector('#btn-connect')?.textContent).toBe('Disconnect');
    fireEvent.click(view.container.querySelector('#btn-connect')!);
    await waitFor(() => expect(view.container.querySelector('#btn-connect')?.textContent).toBe('Connect'));
  });
});
