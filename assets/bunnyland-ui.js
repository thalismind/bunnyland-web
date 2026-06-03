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

  window.BunnylandUI = {
    cloneJson,
    escapeHtml,
    initTheme,
    setTheme,
  };

  initTheme();
}());
