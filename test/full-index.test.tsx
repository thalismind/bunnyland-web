import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CopyCommand, LandingPage } from '../src/index/page';
import { ToolLinks, type ToolLink } from '../src/index/tool-links';

const api = {
  assertSameOriginBase: vi.fn((base: string) => base),
  sendJson: vi.fn(),
  serverFromUrl: vi.fn(() => ''),
};
const initClientMenu = vi.fn();
const writeText = vi.fn(async () => undefined);

function configResponse(config: unknown) {
  return { json: vi.fn(async () => config), ok: true } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.serverFromUrl.mockReturnValue('');
  history.replaceState(null, '', '/index.html');
  vi.stubGlobal('BunnylandApi', api);
  vi.stubGlobal('BunnylandUI', { initClientMenu });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('LandingPage deployment state', () => {
  it('applies deployment config, Discord, absolute commands, and server features', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => configResponse({
      discordUrl: ' https://discord.gg/bunnyland ',
      serverUrl: '/custom-api/',
    })));
    api.sendJson.mockResolvedValue({ character_chat: false, character_sheets: true });

    const view = render(<LandingPage />);
    await waitFor(() => expect(view.getByText('Available on this server.')).toBeTruthy());

    expect(view.getByRole('heading', { level: 1 }).textContent).toBe('Welcome to Bunnyland');
    expect(view.getByRole('link', { name: 'Play in Web TUI' }).classList.contains('primary')).toBe(true);
    expect(view.container.querySelector<HTMLAnchorElement>('.play-list a')?.textContent).toBe('Open Web TUI');
    expect(view.getByRole('link', { name: 'Toon Client' }).classList.contains('primary')).toBe(false);
    expect(view.getByText('Choose and claim an available character.')).toBeTruthy();
    expect(view.container.textContent).not.toMatch(/Moss|Juniper|Market Lane|post office|market apple/);
    const discord = view.container.querySelector<HTMLAnchorElement>('#discord-link')!;
    expect(discord.href).toBe('https://discord.gg/bunnyland');
    expect(discord.style.display).toBe('');
    expect(view.container.querySelector('#cmd-tui')?.textContent).toContain('/custom-api');
    expect(api.sendJson.mock.calls[0]?.[0]).toMatch(/^http.*\/custom-api$/);
    expect(api.sendJson.mock.calls[0]?.[1]).toBe('/public/features');
    expect(view.container.querySelector('#character-card')?.classList.contains('feature-disabled')).toBe(false);
    expect(view.container.querySelector('#character-link')?.getAttribute('href')).toContain('%2Fcustom-api');
    for (const page of ['toon-client.html', 'web-tui.html', 'web-repl.html']) {
      const links = [...view.container.querySelectorAll<HTMLAnchorElement>(`a[href^="${page}"]`)];
      expect(links.length).toBeGreaterThan(0);
      expect(links.every(link => new URL(link.href).searchParams.get('server') === '/custom-api')).toBe(true);
    }
    for (const page of ['world-generator.html', 'behavior-editor.html', 'character-memory.html', 'event-stream.html', 'trace-analyzer.html']) {
      const link = view.container.querySelector<HTMLAnchorElement>(`a[href^="${page}"]`)!;
      expect(new URL(link.href).searchParams.get('server')).toBe('/custom-api');
    }
    expect(view.container.querySelector<HTMLAnchorElement>('a[href^="script-editor.html"]')?.search).toBe('');
    expect(view.container.querySelector('#character-link')?.getAttribute('aria-disabled')).toBe('false');
    expect(initClientMenu).toHaveBeenCalledOnce();
  });

  it('uses same-origin fallback commands and disables features when config and status fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('missing config'); }));
    api.sendJson.mockRejectedValue(new Error('offline'));

    const view = render(<LandingPage />);
    await waitFor(() => expect(view.getByText('Disabled on this server.')).toBeTruthy());

    expect(view.container.querySelector('#cmd-repl')?.textContent).toContain('/api');
    expect(view.container.querySelector<HTMLAnchorElement>('#discord-link')?.style.display).toBe('none');
    expect(view.container.querySelector('#character-card')?.classList.contains('feature-disabled')).toBe(true);
    expect(view.container.querySelector('#character-link')?.getAttribute('tabindex')).toBe('-1');
  });

  it('prefers the linked server over deployment config when generating cross-page links', async () => {
    history.replaceState(null, '', '/index.html?server=%2Flinked-api#ignored-focus');
    api.serverFromUrl.mockReturnValue('/linked-api');
    vi.stubGlobal('fetch', vi.fn(async () => configResponse({ serverUrl: '/configured-api/' })));
    api.sendJson.mockResolvedValue({ character_chat: true, character_sheets: true });

    const view = render(<LandingPage />);
    await waitFor(() => expect(view.getByText('Available on this server.')).toBeTruthy());
    const toon = view.container.querySelector<HTMLAnchorElement>('a[href^="toon-client.html"]')!;
    expect(new URL(toon.href).searchParams.get('server')).toBe('/linked-api');
    expect(location.hash).toBe('#ignored-focus');
  });

  it('aborts an unfinished config request when unmounted', () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, options?: RequestInit) => {
      signal = options?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    }));
    const view = render(<LandingPage />);
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});

describe('CopyCommand', () => {
  it('copies the absolute command and clears its feedback timer on unmount', async () => {
    vi.useFakeTimers();
    const view = render(<CopyCommand id="cmd-test" program="bunnyland repl" server="https://play.test/api" />);
    await act(async () => {
      fireEvent.click(view.getByText('Copy'));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('bunnyland repl --server https://play.test/api');
    expect(view.getByText('Copied')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('ToolLinks', () => {
  it('retains keyed tool cards when their descriptions change', () => {
    const tool: ToolLink = {
      description: 'Inspect the world.', href: 'inspector.html', label: 'Open Inspector', title: 'Inspector',
    };
    const view = render(<ToolLinks links={[tool]} server="/api" />);
    const original = view.container.querySelector('[data-tool-href="inspector.html"]');
    view.rerender(<ToolLinks links={[{ ...tool, description: 'Inspect the live world.' }]} server="/api" />);
    expect(view.container.querySelector('[data-tool-href="inspector.html"]')).toBe(original);
    expect(view.getByText('Inspect the live world.')).toBeTruthy();
  });
});
