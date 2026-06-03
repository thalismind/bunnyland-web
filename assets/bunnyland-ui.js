(function () {
  'use strict';

  const THEME_KEY = 'bunnyland.theme';

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
    document.documentElement.dataset.theme = theme;
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
    document.documentElement.dataset.theme = theme;
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
    initTheme,
    setTheme,
  };

  initTheme();
}());
