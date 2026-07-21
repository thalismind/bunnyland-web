(function () {
  'use strict';

  const THEME_KEY = 'bunnyland.theme';
  const THEME_CLASS_PREFIX = 'bl-theme-';
  const COLOR_SCHEME_KEY = 'bunnyland.color-scheme';
  const COLOR_SCHEME_CLASS_PREFIX = 'bl-color-scheme-';
  const DEFAULT_THEME = 'midnight';
  const THEME_ALIASES = {
    anime: 'candy',
    'anime-dark': 'candy-dark',
    'anime-light': 'candy-light',
    dark: 'midnight-dark',
    light: 'midnight-light',
    'purple-blue': 'midnight',
    'purple-blue-dark': 'midnight-dark',
    'purple-blue-light': 'midnight-light',
  };
  const DEFAULT_THEME_OPTIONS = [
    { value: 'midnight', label: 'Midnight Blue / Lavender' },
    { value: 'candy', label: 'Candy Pink / Cyan' },
    { value: 'earth', label: 'Earth Green / Gold' },
    { value: 'ocean', label: 'Ocean Teal / Coral' },
    { value: 'sunset', label: 'Sunset Orange / Plum' },
    { value: 'high-contrast', label: 'High Contrast' },
  ];
  const COLOR_SCHEME_OPTIONS = [
    { value: 'auto', label: 'Auto (System)' },
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
  ];
  const THEME_OPTIONS = DEFAULT_THEME_OPTIONS.map(option => ({ ...option }));
  const THEME_VALUE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
  const boundThemeSelects = new Set();
  const boundColorSchemeSelects = new Set();
  const CLIENT_MENU_SEEN_KEY = 'bunnyland.clientMenu.seen';
  let clientMenuBaseUrl = '';
  // Admin tools order: World Generator, World Graph, editor tools alphabetically, then miscellaneous tools.
  const CLIENT_MENU_ITEMS = [
    {
      href: 'index.html',
      title: 'Welcome',
      label: 'Start here',
      description: 'Project overview, docs, admin notes, and client chooser.',
      supportsServer: true,
    },
    {
      href: 'https://bunnyland.dev/',
      title: 'Bunnyland.dev',
      label: 'Website',
      description: 'Project homepage, feature overview, guides, and public docs.',
      supportsServer: false,
    },
    {
      href: 'toon-client.html',
      title: 'Toon Client',
      label: 'Player room view',
      description: 'Claim a character and play from the room-focused visual client.',
      supportsFocus: true,
      supportsServer: true,
    },
    {
      href: 'web-tui.html',
      title: 'Web TUI',
      label: 'Player action menu',
      description: 'Claim a character and play from the terminal TUI-style browser client.',
      supportsFocus: true,
      supportsServer: true,
    },
    {
      href: 'web-repl.html',
      title: 'Web REPL',
      label: 'Text-based play',
      description: 'Claim a character and play with typed commands in the browser.',
      supportsFocus: true,
      supportsServer: true,
    },
    {
      href: 'character.html',
      title: 'Character Profile',
      label: 'Profile and chat',
      description: 'Open a character profile, inspect live state, and chat in character.',
      supportsFocus: true,
      supportsServer: true,
    },
    {
      href: 'world-generator.html',
      title: 'World Generator',
      label: 'Admin generator',
      description: 'Generate or replace a live world using enabled server generators.',
      supportsServer: true,
      admin: true,
    },
    {
      href: 'inspector.html',
      title: 'World Graph',
      label: 'Graph editor',
      description: 'Browse and extend the ECS world graph from a snapshot or live server.',
      supportsServer: true,
      admin: true,
    },
    {
      href: 'behavior-editor.html',
      title: 'Behavior Editor',
      label: 'Behavior trees',
      description: 'Author behavior-tree JSON for behavioral controllers and register it live.',
      supportsServer: true,
      admin: true,
    },
    {
      href: 'character-memory.html',
      title: 'Memory Editor',
      label: 'Memory editor',
      description: 'Inspect and edit character memory collections on a live server.',
      supportsServer: true,
      admin: true,
    },
    {
      href: 'script-editor.html',
      title: 'Script Editor',
      label: 'Automation scripts',
      description: 'Create and validate script JSON blocks against a snapshot.',
      supportsServer: false,
      admin: true,
    },
    {
      href: 'world-editor.html',
      title: 'World Editor',
      label: 'Admin editor',
      description: 'Edit entities, components, relationships, fragments, and live snapshots.',
      supportsServer: true,
      admin: true,
    },
    {
      href: 'event-stream.html',
      title: 'Event Stream',
      label: 'Event viewer',
      description: 'Watch the live world event feed with expandable records and entity references.',
      supportsServer: true,
      admin: true,
    },
    {
      href: 'trace-analyzer.html',
      title: 'Trace Analyzer',
      label: 'Trace inspection',
      description: 'Inspect live Tempo traces or load JSON and JSONL trace artifacts.',
      supportsServer: true,
      admin: true,
    },
  ];
  const FOCUS_PAGE_NAMES = new Set([
    'toon-client.html', 'web-tui.html', 'web-repl.html', 'character.html',
  ]);

  let deployConfigPromise = null;

  // Fetch the deployment's config.json once and reuse it. Every client already reads this
  // file for serverUrl/autoConnect; the shared menu reads it too so a configured Discord
  // invite and custom themes can appear on every page without each client wiring them up.
  function loadConfig() {
    if (!deployConfigPromise) {
      deployConfigPromise = fetch('config.json', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : {}))
        .then((config) => {
          registerThemeOptions(config?.themes);
          initTheme(config?.theme || config?.defaultTheme);
          return config;
        })
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

  function normalizeTags(value) {
    if (Array.isArray(value)) return value.map(tag => String(tag)).filter(Boolean);
    if (typeof value === 'string') return value.split(',').map(tag => tag.trim()).filter(Boolean);
    return [];
  }

  function tagEditorHtml(tags, options = {}) {
    const values = normalizeTags(tags);
    const hiddenClass = options.hiddenClass || 'component-tags-value';
    const hiddenAttributes = options.hiddenAttributes || '';
    const disabled = options.disabled ? ' disabled' : '';
    const addLabel = options.addLabel || 'Add Tag';
    const placeholder = options.placeholder || 'add tag...';
    return `
      <div class="tag-editor">
        <input class="${escapeHtml(hiddenClass)}" ${hiddenAttributes} type="hidden" value="${escapeHtml(JSON.stringify(values))}">
        <div class="tag-list">
          ${values.map(tag => `
            <span class="tag-pill">
              <span>${escapeHtml(tag)}</span>
              <button type="button" data-remove-tag="${escapeHtml(tag)}" aria-label="Remove tag ${escapeHtml(tag)}"${disabled}>x</button>
            </span>
          `).join('') || '<span class="tiny">No tags.</span>'}
        </div>
        <div class="tag-entry">
          <input class="tag-input" type="text" placeholder="${escapeHtml(placeholder)}" spellcheck="false"${disabled}>
          <button type="button" data-add-tag${disabled}>${escapeHtml(addLabel)}</button>
        </div>
      </div>
    `;
  }

  function readTagEditorTags(editor, options = {}) {
    const hidden = editor.querySelector(options.hiddenSelector || '.component-tags-value');
    try {
      const parsed = JSON.parse(hidden?.value || '[]');
      return normalizeTags(parsed);
    } catch (_err) {
      return [];
    }
  }

  function renderTagEditorTags(editor, tags) {
    const list = editor.querySelector('.tag-list');
    if (!list) return;
    const values = normalizeTags(tags);
    list.innerHTML = values.length
      ? values.map(tag => `
        <span class="tag-pill">
          <span>${escapeHtml(tag)}</span>
          <button type="button" data-remove-tag="${escapeHtml(tag)}" aria-label="Remove tag ${escapeHtml(tag)}">x</button>
        </span>
      `).join('')
      : '<span class="tiny">No tags.</span>';
  }

  function bindTagEditor(editor, options = {}) {
    const input = editor.querySelector('.tag-input');
    const add = editor.querySelector('[data-add-tag]');
    const hidden = editor.querySelector(options.hiddenSelector || '.component-tags-value');
    const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
    const update = (tags) => {
      const values = normalizeTags(tags);
      if (hidden) hidden.value = JSON.stringify(values);
      renderTagEditorTags(editor, values);
      onChange(values);
    };
    const addTag = () => {
      const tag = input?.value.trim();
      if (!tag) return;
      const tags = readTagEditorTags(editor, options);
      if (!tags.includes(tag)) tags.push(tag);
      input.value = '';
      update(tags);
      input.focus();
    };
    add?.addEventListener('click', addTag);
    input?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      addTag();
    });
    editor.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-tag]');
      if (!button) return;
      update(readTagEditorTags(editor, options).filter(tag => tag !== button.dataset.removeTag));
    });
    return { readTags: () => readTagEditorTags(editor, options), update };
  }

  function isKnownTheme(name) {
    return THEME_OPTIONS.some(option => option.value === name);
  }

  function parseThemeSelection(name) {
    const value = String(name || DEFAULT_THEME).trim();
    const raw = THEME_ALIASES[value] || value;
    if (isKnownTheme(raw)) return { theme: raw, scheme: null };
    const match = raw.match(/^(.*)-(dark|light)$/);
    if (match && isKnownTheme(match[1])) return { theme: match[1], scheme: match[2] };
    return { theme: raw, scheme: null };
  }

  function normalizeThemeValue(name) {
    return parseThemeSelection(name).theme;
  }

  function sanitizeThemeOption(option) {
    const value = String(option?.value || '').trim();
    if (!THEME_VALUE_PATTERN.test(value)) return null;
    const label = String(option?.label || value).trim() || value;
    return { value, label };
  }

  function renderThemeSelect(select) {
    const theme = currentTheme();
    select.innerHTML = themeOptions().map(option => `
      <option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>
    `).join('');
    select.value = theme;
  }

  function refreshThemeSelects() {
    for (const select of boundThemeSelects) renderThemeSelect(select);
  }

  function normalizeColorScheme(name) {
    return name === 'dark' || name === 'light' ? name : 'auto';
  }

  function colorSchemeOptions() {
    return COLOR_SCHEME_OPTIONS.map(option => ({ ...option }));
  }

  function currentColorScheme() {
    return normalizeColorScheme(document.documentElement.dataset.colorScheme);
  }

  function renderColorSchemeSelect(select) {
    select.innerHTML = colorSchemeOptions().map(option => `
      <option value="${option.value}">${option.label}</option>
    `).join('');
    select.value = currentColorScheme();
  }

  function refreshColorSchemeSelects() {
    for (const select of boundColorSchemeSelects) renderColorSchemeSelect(select);
  }

  function themeFromSearch(search = location.search || '') {
    const requested = new URLSearchParams(search).get('theme');
    if (!requested) return null;
    const theme = normalizeThemeValue(requested);
    return isKnownTheme(theme) ? theme : null;
  }

  function normalizeTheme(name) {
    const theme = normalizeThemeValue(name);
    return isKnownTheme(theme) ? theme : DEFAULT_THEME;
  }

  function currentTheme() {
    return normalizeTheme(document.documentElement.dataset.theme);
  }

  function applyTheme(theme, persist = true) {
    const root = document.documentElement;
    for (const className of [...root.classList]) {
      if (className.startsWith(THEME_CLASS_PREFIX)) root.classList.remove(className);
    }
    root.classList.add(`${THEME_CLASS_PREFIX}${theme}`);
    root.dataset.theme = theme;
    if (persist) storageSet(THEME_KEY, theme);
    refreshThemeSelects();
    return theme;
  }

  function applyColorScheme(scheme, persist = true) {
    const root = document.documentElement;
    for (const className of [...root.classList]) {
      if (className.startsWith(COLOR_SCHEME_CLASS_PREFIX)) root.classList.remove(className);
    }
    if (scheme !== 'auto') root.classList.add(`${COLOR_SCHEME_CLASS_PREFIX}${scheme}`);
    root.dataset.colorScheme = scheme;
    if (persist) storageSet(COLOR_SCHEME_KEY, scheme);
    refreshColorSchemeSelects();
    return scheme;
  }

  function setColorScheme(name) {
    return applyColorScheme(normalizeColorScheme(name), true);
  }

  function setTheme(name) {
    const selection = parseThemeSelection(name);
    if (selection.scheme) applyColorScheme(selection.scheme, true);
    const theme = normalizeTheme(selection.theme);
    return applyTheme(theme, true);
  }

  function initTheme(defaultTheme = DEFAULT_THEME, search = location.search || '') {
    const linkedValue = new URLSearchParams(search).get('theme');
    const linkedTheme = themeFromSearch(search);
    const stored = storageGet(THEME_KEY);
    const selection = parseThemeSelection((linkedTheme && linkedValue) || stored || defaultTheme || DEFAULT_THEME);
    const storedScheme = storageGet(COLOR_SCHEME_KEY);
    applyColorScheme(selection.scheme || normalizeColorScheme(storedScheme), Boolean(selection.scheme || storedScheme));
    const theme = normalizeTheme(selection.theme);
    return applyTheme(theme, Boolean(linkedTheme || (stored && isKnownTheme(selection.theme))));
  }

  function themeOptions() {
    return THEME_OPTIONS.map(option => ({ ...option }));
  }

  function registerThemeOption(option) {
    const theme = sanitizeThemeOption(option);
    if (!theme) return null;
    const index = THEME_OPTIONS.findIndex(existing => existing.value === theme.value);
    if (index === -1) THEME_OPTIONS.push(theme);
    else THEME_OPTIONS[index] = theme;
    refreshThemeSelects();
    return { ...theme };
  }

  function registerThemeOptions(options) {
    if (!Array.isArray(options)) return [];
    return options.map(option => registerThemeOption(option)).filter(Boolean);
  }

  function bindThemeSelect(select) {
    if (!select) return null;
    boundThemeSelects.add(select);
    renderThemeSelect(select);
    select.value = currentTheme();
    select.addEventListener('change', () => setTheme(select.value));
    return { setValue: (value) => { select.value = normalizeTheme(value); setTheme(select.value); } };
  }

  function bindColorSchemeSelect(select) {
    if (!select) return null;
    boundColorSchemeSelects.add(select);
    renderColorSchemeSelect(select);
    select.addEventListener('change', () => setColorScheme(select.value));
    return { setValue: (value) => { select.value = normalizeColorScheme(value); setColorScheme(select.value); } };
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
    const url = new URL(item.href, clientMenuBaseUrl || location.href);
    url.hash = item.supportsFocus && FOCUS_PAGE_NAMES.has(currentPageName()) ? location.hash : '';
    if (item.supportsServer) {
      const server = currentServerValue();
      if (server) url.searchParams.set('server', server);
    }
    if (url.origin !== location.origin) return url.toString();
    if (clientMenuBaseUrl) return `${url.pathname}${url.search}${url.hash}`;
    return `${url.pathname.split('/').pop()}${url.search}${url.hash}`;
  }

  function clientTargetAttrs(item) {
    const url = new URL(item.href, location.href);
    return url.origin === location.origin ? '' : ' target="_blank" rel="noopener"';
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
    const theme = currentTheme();
    const colorScheme = currentColorScheme();
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
              <a class="client-menu-item ${active ? 'active' : ''}" href="${escapeHtml(clientHref(item))}"${clientTargetAttrs(item)}>
                <span class="client-menu-item-main">
                  <span class="client-menu-item-title">${escapeHtml(item.title)}${item.admin ? '<span class="client-menu-admin-badge" title="Requires authentication" aria-label="Requires authentication">●</span>' : ''}</span>
                  <span class="client-menu-item-desc">${escapeHtml(item.description)}</span>
                </span>
                <span class="client-menu-item-label">${escapeHtml(active ? 'Current' : item.label)}</span>
              </a>
            `;
          }).join('')}
        </div>
        <div class="client-menu-footer">
          <label class="client-menu-theme" for="client-menu-theme-select">
            <span>Palette</span>
            <select id="client-menu-theme-select">
              ${themeOptions().map(option => `
                <option value="${escapeHtml(option.value)}" ${option.value === theme ? 'selected' : ''}>${escapeHtml(option.label)}</option>
              `).join('')}
            </select>
          </label>
          <label class="client-menu-theme" for="client-menu-color-scheme-select">
            <span>Appearance</span>
            <select id="client-menu-color-scheme-select">
              ${colorSchemeOptions().map(option => `
                <option value="${option.value}" ${option.value === colorScheme ? 'selected' : ''}>${option.label}</option>
              `).join('')}
            </select>
          </label>
          ${discordUrl ? `
            <a class="client-menu-discord" href="${escapeHtml(discordUrl)}" target="_blank" rel="noopener">Join the Discord</a>
          ` : ''}
          <p class="client-menu-admin-note"><span class="client-menu-admin-badge">●</span> Admin tools require authentication.</p>
        </div>
      </div>
    `;
    dialog.querySelector('#client-menu-theme-select')?.addEventListener('change', (event) => {
      setTheme(event.target.value);
      renderClientMenu(dialog, discordUrl);
    });
    dialog.querySelector('#client-menu-color-scheme-select')?.addEventListener('change', (event) => {
      setColorScheme(event.target.value);
      renderClientMenu(dialog, discordUrl);
    });
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

  function initClientMenu({ baseUrl = '', buttonId = 'btn-client-menu', showOnFirstLoad = false } = {}) {
    if (baseUrl) clientMenuBaseUrl = new URL(baseUrl, location.href).toString();
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

  // Whether a keyboard event originated in a field the user is typing into, so a global
  // shortcut like "?" never hijacks a real keystroke (e.g. typing a query into a filter).
  function isEditableTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true;
  }

  function ensureHelpDialog() {
    let dialog = document.getElementById('help-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('div');
    dialog.id = 'help-dialog';
    dialog.className = 'client-menu-backdrop hidden';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'help-dialog-title');
    document.body.appendChild(dialog);
    return dialog;
  }

  function renderHelp(dialog, { title, intro, sections }) {
    const sectionHtml = (sections || []).map((section) => `
      <div class="help-section-title">${escapeHtml(section.title)}</div>
      ${(section.items || []).map((item) => `
        <div class="client-menu-item">
          <span class="client-menu-item-main">
            <span class="client-menu-item-title">${escapeHtml(item.label)}</span>
            ${item.desc ? `<span class="client-menu-item-desc">${escapeHtml(item.desc)}</span>` : ''}
          </span>
          ${item.key ? `<span class="client-menu-item-label">${escapeHtml(item.key)}</span>` : ''}
        </div>
      `).join('')}
    `).join('');
    dialog.innerHTML = `
      <div class="client-menu-card">
        <div class="client-menu-header">
          <div>
            <div class="client-menu-kicker">Bunnyland</div>
            <div id="help-dialog-title" class="client-menu-title">${escapeHtml(title || 'Controls & commands')}</div>
          </div>
          <button class="client-menu-close" type="button" aria-label="Close help">x</button>
        </div>
        <div class="client-menu-list">
          ${intro ? `<p class="help-intro">${escapeHtml(intro)}</p>` : ''}
          ${sectionHtml}
        </div>
      </div>
    `;
  }

  // A shared help modal: the GUI clients (toon, web-tui) have no typed "help" command, so
  // surface their controls and iconography here. Opens from a toolbar button and the "?"
  // key (ignored while typing), matching the terminal TUI's "?" help binding.
  function initHelp({ title, intro, sections = [], buttonId = 'btn-help' } = {}) {
    const open = () => {
      const dialog = ensureHelpDialog();
      renderHelp(dialog, { title, intro, sections });
      dialog.classList.remove('hidden');
      dialog.querySelector('.client-menu-close')?.focus();
    };
    const close = () => document.getElementById('help-dialog')?.classList.add('hidden');

    const button = document.getElementById(buttonId);
    if (button) button.addEventListener('click', () => open());

    document.addEventListener('click', (event) => {
      const dialog = document.getElementById('help-dialog');
      if (!dialog || dialog.classList.contains('hidden')) return;
      if (event.target === dialog || event.target.closest('.client-menu-close')) close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { close(); return; }
      if (event.key !== '?' || isEditableTarget(event.target)) return;
      event.preventDefault();
      const dialog = document.getElementById('help-dialog');
      if (dialog && !dialog.classList.contains('hidden')) close();
      else open();
    });

    return { open, close };
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
    bindColorSchemeSelect,
    bindTagEditor,
    bindSearchDropdown,
    bindThemeSelect,
    cloneJson,
    colorSchemeOptions,
    currentColorScheme,
    escapeHtml,
    currentTheme,
    initClientMenu,
    initHelp,
    initTheme,
    loadConfig,
    normalizeTags,
    normalizeTheme,
    registerThemeOption,
    registerThemeOptions,
    renderTagEditorTags,
    setTheme,
    setColorScheme,
    tagEditorHtml,
    themeFromSearch,
    themeOptions,
  };

  initTheme();
  loadConfig();
}());
