import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CharacterChatPage, HISTORY_LIMIT, loadChatState, renderMarkdown, type CharacterChatRuntime } from '../src/character-chat/page';

const CLIENT_ID = 'chat-test-client';
const CHARACTER_ID = 'character:1';

function runtime(options: { queued?: boolean } = {}) {
  const close = vi.fn();
  const posted: Array<Record<string, unknown>> = [];
  const chatRuntime: CharacterChatRuntime = {
    api: {
      applyConfigToInput: vi.fn(async () => ({})),
      applyServerParam: vi.fn(() => ''),
      claimHeaders: vi.fn(() => ({})),
      mediaUrl: (base, path) => `${base}${path}`,
      normalizeBase: value => value.replace(/\/$/, ''),
      sendJson: vi.fn(async (_base, path, request) => {
        if (path.endsWith('/chat/status')) return { enabled: true, allowed_tools: ['look', 'remember'] };
        if (path.endsWith('/world/characters')) return {
          characters: [
            { character_id: CHARACTER_ID, name: 'Juniper', kind: 'character' },
            { character_id: 'character:2', name: 'Hazel', kind: 'character' },
          ],
        };
        if (path.includes('/chat/pending/')) return {
          complete: true,
          reply: 'I remember.',
          action: { tool: 'remember', command_id: 'cmd-1', status: 'executed' },
        };
        if (path.endsWith('/chat')) {
          posted.push(JSON.parse(request?.body || '{}') as Record<string, unknown>);
          return options.queued
            ? { reply: 'I will try.', action: { tool: 'remember', command_id: 'cmd-1', status: 'queued' } }
            : { reply: 'hello back', action: { tool: 'look', status: 'executed' } };
        }
        return { portrait: { url: '/media/juniper.png' } };
      }),
      setServerInUrl: vi.fn(),
    },
    play: {
      actionIcon: action => action.tool_name === 'remember' ? '🧠' : '👁',
      createPlayerLiveUpdates: vi.fn(({ onState }) => {
        onState('fallback');
        return { close };
      }),
      persistentClientId: () => CLIENT_ID,
      storedClaimControl: () => null,
    },
    ui: { initClientMenu: vi.fn(), initTheme: vi.fn() },
  };
  return { close, posted, runtime: chatRuntime };
}

async function connectAndSelect(view: ReturnType<typeof render>) {
  fireEvent.input(view.container.querySelector('#api-url')!, { target: { value: '/api' } });
  fireEvent.click(view.container.querySelector('#btn-connect')!);
  await waitFor(() => expect(view.container.querySelectorAll('.character-row')).toHaveLength(2));
  fireEvent.click(view.container.querySelector(`[data-id="${CHARACTER_ID}"]`)!);
  await waitFor(() => expect(view.container.querySelector('#chat-portrait-frame img')).toBeTruthy());
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  history.replaceState(null, '', '/character-chat.html');
  vi.useRealTimers();
});

describe('CharacterChatPage', () => {
  it('connects, filters, selects, sends, and retains keyed character rows', async () => {
    const harness = runtime();
    const view = render(<CharacterChatPage runtime={harness.runtime} />);
    await connectAndSelect(view);
    expect(view.container.querySelector('#status-line')?.textContent).toContain('Chatting with Juniper');
    expect(view.container.querySelector('#chat-tool-list')?.textContent).toContain('Tools: look, remember');

    fireEvent.input(view.container.querySelector('#character-filter')!, { target: { value: 'hazel' } });
    expect(view.container.querySelectorAll('.character-row')).toHaveLength(1);
    fireEvent.click(view.container.querySelector('#character-filter-clear')!);
    expect(view.container.querySelectorAll('.character-row')).toHaveLength(2);
    const row = view.container.querySelector(`[data-id="${CHARACTER_ID}"]`);

    fireEvent.input(view.container.querySelector('#chat-input')!, { target: { value: 'hello' } });
    fireEvent.click(view.container.querySelector('#btn-send')!);
    await waitFor(() => expect(view.container.querySelector('#transcript')?.textContent).toContain('hello back'));
    expect(harness.posted[0]).toMatchObject({ client_id: CLIENT_ID, message: 'hello', history: [] });
    expect(view.container.querySelector(`[data-id="${CHARACTER_ID}"]`)).toBe(row);
    expect(view.container.querySelector(`[data-id="${CHARACTER_ID}"]`)?.classList.contains('has-history')).toBe(true);
    expect(loadChatState(CLIENT_ID, CHARACTER_ID).messages).toHaveLength(3);
    expect(location.hash).toBe(`#${encodeURIComponent(CHARACTER_ID)}`);
  });

  it('preserves the server query while restoring focus from hash and back navigation', async () => {
    history.replaceState(null, '', `/character-chat.html?server=%2Fapi#${encodeURIComponent(CHARACTER_ID)}`);
    const harness = runtime();
    const view = render(<CharacterChatPage runtime={harness.runtime} />);
    fireEvent.input(view.container.querySelector('#api-url')!, { target: { value: '/api' } });
    fireEvent.click(view.container.querySelector('#btn-connect')!);
    await waitFor(() => expect(view.container.querySelector(`[data-id="${CHARACTER_ID}"]`)?.classList.contains('active')).toBe(true));
    expect(location.search).toBe('?server=%2Fapi');

    history.replaceState(null, '', '/character-chat.html?server=%2Fapi#character%3A2');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(view.container.querySelector('[data-id="character:2"]')?.classList.contains('active')).toBe(true));
    expect(location.search).toBe('?server=%2Fapi');
  });

  it('bounds persisted history and renders only sanitized markdown HTML', () => {
    const messages = Array.from({ length: HISTORY_LIMIT + 6 }, (_, index) => ({
      role: index % 2 ? 'character' : 'user', text: `old ${index}`,
    }));
    localStorage.setItem(`bunnyland.characterChat.history.${CLIENT_ID}.${CHARACTER_ID}`, JSON.stringify({ summary: 'summary', messages }));
    const state = loadChatState(CLIENT_ID, CHARACTER_ID);
    expect(state.messages).toHaveLength(HISTORY_LIMIT);
    expect(state.messages[0]?.text).toBe('old 6');

    const html = renderMarkdown('**bold** `code` [safe](https://example.test) <img src=x> [bad](javascript:alert(1))');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('href="https://example.test/"');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).not.toContain('href="javascript:');
  });

  it('closes live updates and clears queued-action polling on unmount', async () => {
    const harness = runtime({ queued: true });
    const view = render(<CharacterChatPage runtime={harness.runtime} />);
    await connectAndSelect(view);
    vi.useFakeTimers();
    fireEvent.input(view.container.querySelector('#chat-input')!, { target: { value: 'queued' } });
    fireEvent.click(view.container.querySelector('#btn-send')!);
    await Promise.resolve();
    await Promise.resolve();
    const timersBeforeUnmount = vi.getTimerCount();
    expect(timersBeforeUnmount).toBeGreaterThan(0);
    view.unmount();
    expect(harness.close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBeLessThan(timersBeforeUnmount);
  });
});
