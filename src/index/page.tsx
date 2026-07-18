import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { ToolLinks, toolLinks } from './tool-links';

interface DeploymentConfig {
  discordUrl?: string;
  serverUrl?: string;
}

interface FeatureStatus {
  character_chat?: boolean;
  character_sheets?: boolean;
}

interface BunnylandApiClient {
  assertSameOriginBase(base: string): string;
  sendJson(base: string, path: string): Promise<{ features?: FeatureStatus }>;
  serverFromUrl(): string;
}

const landingGlobals = globalThis as typeof globalThis & {
  BunnylandApi: BunnylandApiClient;
  BunnylandUI: { initClientMenu(): void };
};

type Availability = 'available' | 'checking' | 'unavailable';

function terminalBase(serverUrl: string): string {
  return new URL(landingGlobals.BunnylandApi.assertSameOriginBase(serverUrl), location.href).href.replace(/\/+$/, '');
}

function clientServer(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, '') || '/api';
}

function useDeployment() {
  const [serverUrl, setServerUrl] = useState('/api/');
  const [discordUrl, setDiscordUrl] = useState('');
  const [availability, setAvailability] = useState<Record<'character_chat' | 'character_sheets', Availability>>({
    character_chat: 'checking',
    character_sheets: 'checking',
  });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void (async () => {
      const linkedServer = landingGlobals.BunnylandApi.serverFromUrl();
      let nextServerUrl = linkedServer || '/api/';
      let nextDiscordUrl = '';
      try {
        const response = await fetch('config.json', { cache: 'no-store', signal: controller.signal });
        if (response.ok) {
          const config = await response.json() as DeploymentConfig | null;
          if (!linkedServer && typeof config?.serverUrl === 'string' && config.serverUrl) nextServerUrl = config.serverUrl;
          if (typeof config?.discordUrl === 'string') nextDiscordUrl = config.discordUrl.trim();
        }
      } catch {
        if (controller.signal.aborted) return;
      }
      if (!active) return;
      setServerUrl(nextServerUrl);
      setDiscordUrl(nextDiscordUrl);

      try {
        const base = terminalBase(nextServerUrl);
        const status = await landingGlobals.BunnylandApi.sendJson(base, '/play/world/status');
        if (!active) return;
        setAvailability({
          character_chat: status.features?.character_chat ? 'available' : 'unavailable',
          character_sheets: status.features?.character_sheets ? 'available' : 'unavailable',
        });
      } catch {
        if (!active) return;
        setAvailability({ character_chat: 'unavailable', character_sheets: 'unavailable' });
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return { availability, discordUrl, serverUrl };
}

export function CopyCommand({ id, program, server }: { id: string; program: string; server: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const command = `${program} --server ${server}`;

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setCopied(false);
      }, 1200);
    } catch {
      // Clipboard can be unavailable in insecure contexts; the command stays selectable.
    }
  };

  return <div class="cmd">
    <code id={id}>{program} <br />--server {server}</code>
    <button type="button" class="cmd-copy" data-copy={id} onClick={() => { void copy(); }}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  </div>;
}

function FeatureCard({
  description,
  feature,
  href,
  label,
  state,
  title,
}: {
  description: string;
  feature: 'character_chat' | 'character_sheets';
  href: string;
  label: string;
  state: Availability;
  title: string;
}) {
  const enabled = state === 'available';
  const idBase = feature === 'character_chat' ? 'character-chat' : 'character-sheet';
  return <article id={`${idBase}-card`} class={`info-card ${enabled ? '' : 'feature-disabled'}`} data-feature={feature}>
    <h3>{title}</h3>
    <p>{description}</p>
    <div class={`feature-state ${enabled ? 'available' : 'unavailable'}`} id={`${idBase}-state`}>
      {state === 'checking' ? 'Checking server feature...' : enabled ? 'Available on this server.' : 'Disabled on this server.'}
    </div>
    <div class="info-actions">
      <a id={`${idBase}-link`} class={`button-link primary ${enabled ? '' : 'disabled'}`} href={href}
        aria-disabled={enabled ? 'false' : 'true'} tabIndex={enabled ? undefined : -1}>{label}</a>
    </div>
  </article>;
}

export function LandingPage() {
  const { availability, discordUrl, serverUrl } = useDeployment();
  useEffect(() => { landingGlobals.BunnylandUI.initClientMenu(); }, []);
  const base = useMemo(() => terminalBase(serverUrl), [serverUrl]);
  const queryServer = clientServer(serverUrl);
  const playerHref = (page: string): string => `${page}?server=${encodeURIComponent(queryServer)}`;
  const chatHref = `character-chat.html?server=${encodeURIComponent(queryServer)}`;
  const sheetHref = `character-sheet.html?server=${encodeURIComponent(queryServer)}`;

  return <div class="welcome-shell">
    <header class="welcome-header">
      <div class="welcome-brand"><img src="favicon.png" alt="" /><span>Bunnyland</span></div>
      <button id="btn-client-menu" class="client-menu-button" type="button">Menu</button>
    </header>

    <main>
      <section class="welcome-hero" aria-labelledby="welcome-title">
        <div>
          <p class="eyebrow">Start here</p>
          <h1 id="welcome-title">Bunnyland Hungry Courier</h1>
          <p class="lede">Humans, NPCs, and AI agents act through the same validated world rules. In the first demo, Moss wants to deliver a letter but must eat real food before the world will let that happen.</p>
          <div class="quick-links" aria-label="Get started">
            <a class="button-link primary" href={playerHref('toon-client.html')}>Play in Toon Client</a>
            <a id="discord-link" class="button-link discord" href={discordUrl || '#'} target="_blank" rel="noopener"
              style={{ display: discordUrl ? '' : 'none' }}>Discord</a>
            <a class="button-link" href={playerHref('web-tui.html')}>Web TUI</a>
            <a class="button-link" href={playerHref('web-repl.html')}>Web REPL</a>
            <a class="button-link" href="https://bunnyland.dev/guides/">Read the Guides</a>
          </div>
        </div>
        <aside class="hero-panel" aria-label="Ways to play">
          <img src="favicon.png" alt="" />
          <div>
            <p><strong>Start here: do these 5 things.</strong></p>
            <ul class="play-list">
              <li><a href={playerHref('toon-client.html')}>Open Toon Client</a> and claim Juniper.</li>
              <li>Use <strong>Look</strong> to read the post office.</li>
              <li>Go east to Market Lane.</li>
              <li>Take the red market apple and bring it back west.</li>
              <li>Drop the apple, then watch Moss act.</li>
            </ul>
          </div>
        </aside>
      </section>

      <section class="section" aria-labelledby="terminal-title">
        <div class="section-heading">
          <div><p class="eyebrow">Text-based play</p><h2 id="terminal-title">Play with commands.</h2></div>
          <p>Use the browser clients without installing anything, or run the terminal clients from a checkout.</p>
        </div>
        <div class="info-grid">
          <article class="info-card">
            <h3>Web TUI</h3>
            <p>A browser version of the terminal TUI: pick a player, filter actions, choose targets, and watch room activity.</p>
            <div class="info-actions">
              <a class="button-link primary" href={playerHref('web-tui.html')}>Open Web TUI</a>
              <a class="button-link" href="https://bunnyland.dev/guides/client-tui.html">Read Player Guide</a>
            </div>
          </article>
          <article class="info-card">
            <h3>Web REPL</h3>
            <p>A browser command line with player claiming, clickable visible names, command history, and live action suggestions.</p>
            <div class="info-actions">
              <a class="button-link primary" href={playerHref('web-repl.html')}>Open Web REPL</a>
              <a class="button-link" href="https://bunnyland.dev/guides/client-repl.html">Read Player Guide</a>
            </div>
          </article>
          <article class="info-card">
            <h3>Textual TUI</h3>
            <p>An ASCII-art interface you drive with the mouse: pick actions from menus and click targets in the room, with no command syntax to memorize.</p>
            <CopyCommand id="cmd-tui" program="uv run --extra tui bunnyland tui" server={base} />
            <div class="info-actions"><a class="button-link" href="https://bunnyland.dev/guides/client-tui.html">Read Player Guide</a></div>
          </article>
          <article class="info-card">
            <h3>Textual REPL</h3>
            <p>A traditional typed command line, with modern touches like clickable names and tab completion.</p>
            <CopyCommand id="cmd-repl" program="uv run --extra repl bunnyland repl" server={base} />
            <div class="info-actions"><a class="button-link" href="https://bunnyland.dev/guides/client-repl.html">Read Player Guide</a></div>
          </article>
        </div>
      </section>

      <section class="section" aria-labelledby="characters-title">
        <div class="section-heading">
          <div><p class="eyebrow">Character views</p><h2 id="characters-title">Profiles and chat.</h2></div>
          <p>These clients use the live server API. Unavailable features stay visible but disabled.</p>
        </div>
        <div class="info-grid">
          <FeatureCard feature="character_chat" title="Character Chat"
            description="Start an in-character conversation with LLM-controlled characters using the limited chat action toolbox."
            label="Open Character Chat" href={chatHref} state={availability.character_chat} />
          <FeatureCard feature="character_sheets" title="Character Sheet"
            description="A read-only profile with portrait, room context, vitals, needs, relationships, visible characters, inventory, and available actions."
            label="Open Character Sheet" href={sheetHref} state={availability.character_sheets} />
        </div>
      </section>

      <section class="section" aria-labelledby="tools-title">
        <div class="section-heading">
          <div><p class="eyebrow">Build &amp; administer</p><h2 id="tools-title">Tools for builders and admins.</h2></div>
          <p>Admin tools ask for your server's admin username and password the first time you open a protected feature.</p>
        </div>
        <div id="tool-client-grid" class="client-grid"><ToolLinks links={toolLinks} server={queryServer} /></div>
      </section>

      <section class="section" aria-labelledby="resources-title">
        <div class="section-heading"><div><p class="eyebrow">Resources</p><h2 id="resources-title">Docs and project links.</h2></div></div>
        <div class="resource-row">
          <a href="https://bunnyland.dev/">Homepage<span>Project overview, sandbox entry, and feature summary.</span></a>
          <a href="https://bunnyland.dev/guides/">Guides<span>Player and admin guides generated from the server docs.</span></a>
          <a href="https://github.com/thalismind/bunnyland-server">Server GitHub<span>Simulation engine, API, plugins, docs, and deployment scripts.</span></a>
          <a href="https://github.com/thalismind/bunnyland-web">Web GitHub<span>Static browser clients, editors, and container image.</span></a>
        </div>
      </section>
    </main>
  </div>;
}

const root = document.getElementById('app');
if (root) render(<LandingPage />, root);
