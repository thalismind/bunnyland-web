(function () {
  'use strict';

  function normalizeBase(url) {
    return String(url || '').trim().replace(/\/$/, '');
  }

  function serverFromUrl() {
    return new URLSearchParams(location.search).get('server') || '';
  }

  function setServerInUrl(base) {
    const url = new URL(location.href);
    const normalized = normalizeBase(base);
    if (normalized) url.searchParams.set('server', normalized);
    else url.searchParams.delete('server');
    history.replaceState(null, '', url);
  }

  async function applyConfigToInput({ inputId = 'api-url', isConnected = () => false, connect = null } = {}) {
    const config = await BunnylandUI.loadConfig();
    const input = document.getElementById(inputId);
    if (config.serverUrl && input && !isConnected()) input.value = config.serverUrl;
    if (config.autoConnect && config.serverUrl && !isConnected() && connect) connect(config.serverUrl);
    return config;
  }

  function applyServerParam({ inputId = 'api-url', connect = null } = {}) {
    const server = serverFromUrl();
    if (!server) return '';
    const input = document.getElementById(inputId);
    if (input) input.value = server;
    if (connect) connect(server);
    return server;
  }

  function jsonHeaders(authHeader = null) {
    if (authHeader && String(authHeader).startsWith('Token ')) {
      return {
        'Content-Type': 'application/json',
        'X-Bunnyland-Admin-Token': String(authHeader).slice(6),
      };
    }
    return {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    };
  }

  async function parseJsonResponse(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    return data;
  }

  async function sendJson(base, path, { method = 'GET', body = null, headers = null } = {}) {
    const res = await fetch(`${normalizeBase(base)}${path}`, {
      method,
      headers: headers || jsonHeaders(),
      body,
    });
    return parseJsonResponse(res);
  }

  function promptBasicAuth() {
    const username = window.prompt('Admin username');
    if (!username) return null;
    const password = window.prompt('Admin password');
    if (password == null) return null;
    return `Basic ${btoa(`${username}:${password}`)}`;
  }

  async function sendAdmin(base, path, {
    method = 'GET',
    body = null,
    prompt = true,
    getAuth = () => null,
    setAuth = () => {},
  } = {}) {
    const currentHeaders = () => jsonHeaders(getAuth());
    let res = await fetch(`${normalizeBase(base)}${path}`, {
      method,
      headers: currentHeaders(),
      body,
    });
    if (res.status === 401 && prompt) {
      const auth = promptBasicAuth();
      if (auth) {
        setAuth(auth);
        res = await fetch(`${normalizeBase(base)}${path}`, {
          method,
          headers: currentHeaders(),
          body,
        });
      }
    }
    return parseJsonResponse(res);
  }

  function socketUrl(base, path = '/world/updates') {
    return `${normalizeBase(base).replace(/^http/, 'ws')}${path}`;
  }

  function mediaUrl(base, url) {
    if (!url) return '';
    if (/^https?:\/\//.test(url)) return url;
    return `${normalizeBase(base)}${url}`;
  }

  async function requestSceneImage(base, characterId) {
    return sendJson(base, `/world/character/${encodeURIComponent(characterId)}/scene-image`, {
      method: 'POST',
    });
  }

  async function requestEventImage(base, recordId, extra = '') {
    return sendJson(base, `/world/event/${encodeURIComponent(recordId)}/image`, {
      method: 'POST',
      body: JSON.stringify({ extra }),
    });
  }

  window.BunnylandApi = {
    applyConfigToInput,
    applyServerParam,
    jsonHeaders,
    mediaUrl,
    normalizeBase,
    parseJsonResponse,
    promptBasicAuth,
    requestEventImage,
    requestSceneImage,
    sendAdmin,
    sendJson,
    serverFromUrl,
    setServerInUrl,
    socketUrl,
  };
}());
