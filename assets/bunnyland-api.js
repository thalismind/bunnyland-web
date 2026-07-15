(function () {
  'use strict';

  let playerAuthHeader = null;
  let rotationTimer = null;

  function normalizeBase(url) {
    return String(url || '').trim().replace(/\/$/, '');
  }

  function assertSameOriginBase(base) {
    const normalized = normalizeBase(base);
    const resolved = new URL(normalized || '/', location.href);
    if (resolved.origin !== location.origin) {
      throw new Error('Bunnyland browser connections must use the page origin');
    }
    return normalized;
  }

  function serverFromUrl() {
    const configured = new URLSearchParams(location.search).get('server') || '';
    return configured ? assertSameOriginBase(configured) : '';
  }

  function setServerInUrl(base) {
    const url = new URL(location.href);
    const normalized = assertSameOriginBase(base);
    if (normalized) url.searchParams.set('server', normalized);
    else url.searchParams.delete('server');
    history.replaceState(null, '', url);
  }

  function truthyConfig(value) {
    return value === true || value === 'true' || value === '1';
  }

  function mergedJsonHeaders(headers = null) {
    return {
      ...(headers || {}),
      ...jsonHeaders(playerAuthHeader),
    };
  }

  function scheduleRotation(base, status) {
    if (rotationTimer) clearTimeout(rotationTimer);
    if (!status?.rotate_after) return;
    const delay = Math.max(0, (Number(status.rotate_after) * 1000) - Date.now());
    rotationTimer = setTimeout(async () => {
      try {
        const next = await rotateAuth(base);
        scheduleRotation(base, next);
      } catch (_error) {
        rotationTimer = null;
      }
    }, Math.min(delay, 2147483647));
  }

  async function authMe(base) {
    const res = await fetch(`${assertSameOriginBase(base)}/auth/me`, { credentials: 'include' });
    return parseJsonResponse(res);
  }

  async function login(base, username, password) {
    const res = await fetch(`${assertSameOriginBase(base)}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, delivery: 'cookie' }),
    });
    const status = await parseJsonResponse(res);
    scheduleRotation(base, status);
    return status;
  }

  async function rotateAuth(base) {
    const res = await fetch(`${assertSameOriginBase(base)}/auth/rotate`, {
      method: 'POST',
      credentials: 'include',
    });
    return parseJsonResponse(res);
  }

  async function logout(base) {
    const res = await fetch(`${assertSameOriginBase(base)}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
    if (rotationTimer) clearTimeout(rotationTimer);
    rotationTimer = null;
    return parseJsonResponse(res);
  }

  async function ensurePlayerAuth(base) {
    try {
      const status = await authMe(base);
      scheduleRotation(base, status);
      return true;
    } catch (_error) {
      return promptPlayerAuth(base);
    }
  }

  async function applyConfigToInput({ inputId = 'api-url', isConnected = () => false, connect = null } = {}) {
    const config = await BunnylandUI.loadConfig();
    const input = document.getElementById(inputId);
    if (config.serverUrl && input && !isConnected()) input.value = config.serverUrl;
    if (config.autoConnect && config.serverUrl && !isConnected() && connect) {
      if (!truthyConfig(config.playerAuthRequired) || await ensurePlayerAuth(config.serverUrl)) {
        connect(config.serverUrl);
      }
    }
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
    return {
      'Content-Type': 'application/json',
      ...(String(authHeader || '').startsWith('Bearer ') ? { Authorization: authHeader } : {}),
    };
  }

  function adminHeaders(authHeader = null, contentType = null) {
    const headers = {};
    if (contentType) headers['Content-Type'] = contentType;
    if (String(authHeader || '').startsWith('Bearer ')) {
      headers.Authorization = authHeader;
    }
    return headers;
  }

  function claimHeaders(control = null) {
    return {
      ...jsonHeaders(playerAuthHeader),
      ...(control?.claimSecret ? { 'X-Bunnyland-Claim-Secret': control.claimSecret } : {}),
    };
  }

  async function parseJsonResponse(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    return data;
  }

  async function sendJson(base, path, { method = 'GET', body = null, headers = null, promptAuth = true } = {}) {
    const currentHeaders = () => mergedJsonHeaders(headers);
    let res = await fetch(`${assertSameOriginBase(base)}${path}`, {
      method,
      headers: currentHeaders(),
      body,
      credentials: 'include',
    });
    if (res.status === 401 && promptAuth) {
      if (await promptPlayerAuth(base)) {
        res = await fetch(`${assertSameOriginBase(base)}${path}`, {
          method,
          headers: currentHeaders(),
          body,
          credentials: 'include',
        });
      }
    }
    return parseJsonResponse(res);
  }

  async function promptPlayerAuth(base) {
    const username = window.prompt('Bunnyland username');
    if (!username) return null;
    const password = window.prompt('Bunnyland password');
    if (password == null) return null;
    try {
      await login(base, username, password);
      return true;
    } catch (error) {
      window.alert(error.message || 'Login failed');
      return false;
    }
  }

  function setPlayerAuth(authHeader = null) {
    playerAuthHeader = String(authHeader || '').startsWith('Bearer ') ? authHeader : null;
  }

  function getPlayerAuth() {
    return playerAuthHeader;
  }

  async function sendAdmin(base, path, {
    method = 'GET',
    body = null,
    prompt = true,
    getAuth = () => null,
  } = {}) {
    const currentHeaders = () => jsonHeaders(getAuth());
    let res = await fetch(`${assertSameOriginBase(base)}${path}`, {
      method,
      headers: currentHeaders(),
      body,
      credentials: 'include',
    });
    if (res.status === 401 && prompt) {
      if (await promptPlayerAuth(base)) {
        res = await fetch(`${assertSameOriginBase(base)}${path}`, {
          method,
          headers: currentHeaders(),
          body,
          credentials: 'include',
        });
      }
    }
    return parseJsonResponse(res);
  }

  async function uploadCharacterImage(base, characterId, purpose, file, {
    prompt = true,
    getAuth = () => null,
  } = {}) {
    const path = `/admin/world/character/${encodeURIComponent(characterId)}/image/${encodeURIComponent(purpose)}`;
    const contentType = file?.type || 'application/octet-stream';
    const currentHeaders = () => adminHeaders(getAuth(), contentType);
    let res = await fetch(`${assertSameOriginBase(base)}${path}`, {
      method: 'POST',
      headers: currentHeaders(),
      body: file,
      credentials: 'include',
    });
    if (res.status === 401 && prompt) {
      if (await promptPlayerAuth(base)) {
        res = await fetch(`${assertSameOriginBase(base)}${path}`, {
          method: 'POST',
          headers: currentHeaders(),
          body: file,
          credentials: 'include',
        });
      }
    }
    return parseJsonResponse(res);
  }

  function socketUrl(base, path = '/admin/world/updates', _authHeader = null) {
    const normalized = assertSameOriginBase(base);
    return new URL(`${normalized}${path}`, location.href).href.replace(/^http/, 'ws');
  }

  function mediaUrl(base, url) {
    if (!url) return '';
    if (url.startsWith('data:')) return url;
    if (/^https?:\/\//.test(url)) {
      assertSameOriginBase(url);
      return url;
    }
    return `${assertSameOriginBase(base)}${url}`;
  }

  async function requestSceneImage(base, characterId, control = null) {
    const params = new URLSearchParams();
    if (control?.claimId) params.set('claim_id', control.claimId);
    const query = params.toString();
    return sendJson(base, `/play/world/character/${encodeURIComponent(characterId)}/scene-image${query ? `?${query}` : ''}`, {
      method: 'POST',
      headers: claimHeaders(control),
    });
  }

  async function requestEventImage(base, recordId, extra = '') {
    return sendJson(base, `/admin/world/event/${encodeURIComponent(recordId)}/image`, {
      method: 'POST',
      body: JSON.stringify({ extra }),
    });
  }

  window.BunnylandApi = {
    applyConfigToInput,
    applyServerParam,
    adminHeaders,
    assertSameOriginBase,
    authMe,
    claimHeaders,
    ensurePlayerAuth,
    getPlayerAuth,
    jsonHeaders,
    login,
    logout,
    mediaUrl,
    normalizeBase,
    parseJsonResponse,
    promptPlayerAuth,
    requestEventImage,
    requestSceneImage,
    sendAdmin,
    sendJson,
    serverFromUrl,
    setServerInUrl,
    setPlayerAuth,
    socketUrl,
    rotateAuth,
    uploadCharacterImage,
  };
}());
