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
        'X-Bunnyland-Admin-Secret': String(authHeader).slice(6),
      };
    }
    return {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    };
  }

  function adminHeaders(authHeader = null, contentType = null) {
    const headers = {};
    if (contentType) headers['Content-Type'] = contentType;
    if (authHeader && String(authHeader).startsWith('Token ')) {
      headers['X-Bunnyland-Admin-Secret'] = String(authHeader).slice(6);
    } else if (authHeader) {
      headers.Authorization = authHeader;
    }
    return headers;
  }

  function claimHeaders(control = null) {
    return {
      ...jsonHeaders(),
      ...(control?.claimSecret ? { 'X-Bunnyland-Claim-Secret': control.claimSecret } : {}),
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

  async function uploadCharacterImage(base, characterId, purpose, file, {
    prompt = true,
    getAuth = () => null,
    setAuth = () => {},
  } = {}) {
    const path = `/admin/world/character/${encodeURIComponent(characterId)}/image/${encodeURIComponent(purpose)}`;
    const contentType = file?.type || 'application/octet-stream';
    const currentHeaders = () => adminHeaders(getAuth(), contentType);
    let res = await fetch(`${normalizeBase(base)}${path}`, {
      method: 'POST',
      headers: currentHeaders(),
      body: file,
    });
    if (res.status === 401 && prompt) {
      const auth = promptBasicAuth();
      if (auth) {
        setAuth(auth);
        res = await fetch(`${normalizeBase(base)}${path}`, {
          method: 'POST',
          headers: currentHeaders(),
          body: file,
        });
      }
    }
    if (res.status === 403 && prompt && !getAuth()) {
      const token = window.prompt('Admin token');
      if (token) {
        setAuth(`Token ${token}`);
        res = await fetch(`${normalizeBase(base)}${path}`, {
          method: 'POST',
          headers: currentHeaders(),
          body: file,
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

  async function requestSceneImage(base, characterId, control = null) {
    const params = new URLSearchParams();
    if (control?.claimId) params.set('claim_id', control.claimId);
    const query = params.toString();
    return sendJson(base, `/world/character/${encodeURIComponent(characterId)}/scene-image${query ? `?${query}` : ''}`, {
      method: 'POST',
      headers: claimHeaders(control),
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
    adminHeaders,
    claimHeaders,
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
    uploadCharacterImage,
  };
}());
