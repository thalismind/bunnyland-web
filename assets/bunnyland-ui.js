(function () {
  'use strict';

  const THEME_KEY = 'bunnyland.theme';
  const THEME_CLASS_PREFIX = 'bl-theme-';
  const CLIENT_MENU_SEEN_KEY = 'bunnyland.clientMenu.seen';
  const CLIENT_MENU_ITEMS = [
    {
      href: 'index.html',
      title: 'Welcome',
      label: 'Start here',
      description: 'Project overview, docs, admin notes, and client chooser.',
      supportsServer: false,
    },
    {
      href: 'inspector.html',
      title: 'Inspector',
      label: 'Graph client',
      description: 'Browse the ECS world graph, inspect entities, and connect to a live server.',
      supportsServer: true,
    },
    {
      href: 'toon-client.html',
      title: 'Toon Client',
      label: 'Player room view',
      description: 'Claim a character and play from the room-focused visual client.',
      supportsServer: true,
    },
    {
      href: 'world-editor.html',
      title: 'World Editor',
      label: 'Admin editor',
      description: 'Edit entities, components, relationships, fragments, and live snapshots.',
      supportsServer: true,
    },
    {
      href: 'world-generator.html',
      title: 'World Generator',
      label: 'Admin generator',
      description: 'Generate or replace a live world using enabled server generators.',
      supportsServer: true,
    },
    {
      href: 'script-editor.html',
      title: 'Script Editor',
      label: 'Automation scripts',
      description: 'Create and validate script JSON blocks against a snapshot.',
      supportsServer: false,
    },
    {
      href: 'behavior-editor.html',
      title: 'Behavior Editor',
      label: 'Behavior trees',
      description: 'Author behavior-tree JSON for behavioral controllers and register it live.',
      supportsServer: true,
    },
  ];

  let deployConfigPromise = null;

  // Fetch the deployment's config.json once and reuse it. Every client already reads this
  // file for serverUrl/autoConnect; the shared menu reads it too so a configured Discord
  // invite can appear in the menu on every page without each client wiring it up.
  function loadConfig() {
    if (!deployConfigPromise) {
      deployConfigPromise = fetch('config.json', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : {}))
        .catch(() => ({}));
    }
    return deployConfigPromise;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function setTheme(name) {
    const theme = name || 'dark';
    const root = document.documentElement;
    for (const className of [...root.classList]) {
      if (className.startsWith(THEME_CLASS_PREFIX)) root.classList.remove(className);
    }
    root.classList.add(`${THEME_CLASS_PREFIX}${theme}`);
    root.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_err) {
      // The current page can still use the theme when storage is unavailable.
    }
  }

  function initTheme() {
    let theme = 'dark';
    try {
      theme = localStorage.getItem(THEME_KEY) || theme;
    } catch (_err) {
      // Keep the default theme when storage is unavailable.
    }
    setTheme(theme);
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (_err) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_err) {
      // Storage is optional; the menu remains available from the toolbar.
    }
  }

  function currentPageName() {
    const path = location.pathname.split('/').pop();
    return path || 'index.html';
  }

  function currentServerValue() {
    const queryServer = new URLSearchParams(location.search).get('server') || '';
    const input = document.getElementById('api-url');
    if (input && queryServer && input.value.trim() === input.defaultValue.trim()) return queryServer;
    if (input && input.value.trim()) return input.value.trim();
    return queryServer;
  }

  function clientHref(item) {
    const url = new URL(item.href, location.href);
    url.hash = '';
    if (item.supportsServer) {
      const server = currentServerValue();
      if (server) url.searchParams.set('server', server);
    }
    return `${url.pathname.split('/').pop()}${url.search}${url.hash}`;
  }

  function ensureClientMenu() {
    let dialog = document.getElementById('client-menu-dialog');
    if (dialog) return dialog;

    dialog = document.createElement('div');
    dialog.id = 'client-menu-dialog';
    dialog.className = 'client-menu-backdrop hidden';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'client-menu-title');
    document.body.appendChild(dialog);
    return dialog;
  }

  function renderClientMenu(dialog, discordUrl = '') {
    const current = currentPageName();
    dialog.innerHTML = `
      <div class="client-menu-card">
        <div class="client-menu-header">
          <div>
            <div class="client-menu-kicker">Bunnyland Clients</div>
            <div id="client-menu-title" class="client-menu-title">Open a client or editor</div>
          </div>
          <button class="client-menu-close" type="button" aria-label="Close client menu">x</button>
        </div>
        <div class="client-menu-list">
          ${CLIENT_MENU_ITEMS.map((item) => {
            const active = item.href === current || (current === '' && item.href === 'index.html');
            return `
              <a class="client-menu-item ${active ? 'active' : ''}" href="${escapeHtml(clientHref(item))}">
                <span class="client-menu-item-main">
                  <span class="client-menu-item-title">${escapeHtml(item.title)}</span>
                  <span class="client-menu-item-desc">${escapeHtml(item.description)}</span>
                </span>
                <span class="client-menu-item-label">${escapeHtml(active ? 'Current' : item.label)}</span>
              </a>
            `;
          }).join('')}
        </div>
        ${discordUrl ? `
          <div class="client-menu-footer">
            <a class="client-menu-discord" href="${escapeHtml(discordUrl)}" target="_blank" rel="noopener">Join the Discord</a>
          </div>
        ` : ''}
      </div>
    `;
  }

  function openClientMenu() {
    const dialog = ensureClientMenu();
    renderClientMenu(dialog);
    dialog.classList.remove('hidden');
    const close = dialog.querySelector('.client-menu-close');
    close?.focus();
    // config.json arrives async; re-render in place once it does so the Discord link
    // appears without blocking the menu from opening immediately.
    loadConfig().then((config) => {
      const url = typeof config?.discordUrl === 'string' ? config.discordUrl.trim() : '';
      if (url && !dialog.classList.contains('hidden')) renderClientMenu(dialog, url);
    });
  }

  function closeClientMenu() {
    document.getElementById('client-menu-dialog')?.classList.add('hidden');
  }

  function initClientMenu({ buttonId = 'btn-client-menu', showOnFirstLoad = false } = {}) {
    const button = document.getElementById(buttonId);
    if (button) {
      button.addEventListener('click', () => openClientMenu());
    }

    document.addEventListener('click', (event) => {
      const dialog = document.getElementById('client-menu-dialog');
      if (!dialog || dialog.classList.contains('hidden')) return;
      if (event.target === dialog || event.target.closest('.client-menu-close')) {
        closeClientMenu();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeClientMenu();
    });

    if (showOnFirstLoad && storageGet(CLIENT_MENU_SEEN_KEY) !== '1') {
      storageSet(CLIENT_MENU_SEEN_KEY, '1');
      requestAnimationFrame(() => openClientMenu());
    }

    return { open: openClientMenu, close: closeClientMenu };
  }

  function bindSearchDropdown(root, { options, value = '', onChange = null, emptyLabel = 'No matches' }) {
    const input = root.querySelector('.search-dropdown-input');
    const hidden = root.querySelector('.search-dropdown-value');
    const menu = root.querySelector('.search-dropdown-menu');
    const items = options.map(option => typeof option === 'string'
      ? { value: option, label: option }
      : { value: option.value, label: option.label || option.value });
    let active = 0;

    const setValue = (nextValue, notify = true) => {
      const item = items.find(option => option.value === nextValue) || null;
      hidden.value = item?.value || '';
      input.value = item?.label || '';
      if (notify && onChange) onChange(hidden.value, item);
    };

    const filteredItems = () => {
      const q = input.value.trim().toLowerCase();
      if (!q) return items;
      return items.filter(item =>
        item.label.toLowerCase().includes(q) ||
        item.value.toLowerCase().includes(q)
      );
    };

    const renderMenu = () => {
      const filtered = filteredItems();
      active = Math.max(0, Math.min(active, filtered.length - 1));
      menu.innerHTML = filtered.length
        ? filtered.map((item, index) => `
          <div class="search-dropdown-option ${index === active ? 'active' : ''}" data-value="${escapeHtml(item.value)}">
            ${escapeHtml(item.label)}
          </div>
        `).join('')
        : `<div class="search-dropdown-empty">${escapeHtml(emptyLabel)}</div>`;
      menu.classList.remove('hidden');
      input.setAttribute('aria-expanded', 'true');
    };

    const chooseActive = () => {
      const item = filteredItems()[active];
      if (!item) return;
      setValue(item.value);
      menu.classList.add('hidden');
      input.setAttribute('aria-expanded', 'false');
    };

    input.addEventListener('input', () => {
      active = 0;
      renderMenu();
    });
    input.addEventListener('focus', () => renderMenu());
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        active += 1;
        renderMenu();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        active -= 1;
        renderMenu();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        chooseActive();
      } else if (event.key === 'Escape') {
        menu.classList.add('hidden');
        input.setAttribute('aria-expanded', 'false');
        input.blur();
      }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        menu.classList.add('hidden');
        input.setAttribute('aria-expanded', 'false');
      }, 150);
    });
    menu.addEventListener('mousedown', (event) => {
      const option = event.target.closest('.search-dropdown-option');
      if (!option) return;
      event.preventDefault();
      setValue(option.dataset.value);
      menu.classList.add('hidden');
      input.setAttribute('aria-expanded', 'false');
    });

    setValue(value, false);
    return { setValue };
  }

  window.BunnylandUI = {
    bindSearchDropdown,
    cloneJson,
    escapeHtml,
    initClientMenu,
    initTheme,
    loadConfig,
    setTheme,
  };

  initTheme();
}());
