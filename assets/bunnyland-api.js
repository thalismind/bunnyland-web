(function () {
  'use strict';

  let playerAuthHeader = null;
  let rotationTimer = null;
  let browserClientId = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }

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
      ...jsonHeaders(playerAuthHeader),
      ...(headers || {}),
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
    const res = await fetch(`${assertSameOriginBase(base)}/auth/session`, {
      credentials: 'include', headers: jsonHeaders(playerAuthHeader),
    });
    return parseJsonResponse(res);
  }

  async function login(base, username, password) {
    const res = await fetch(`${assertSameOriginBase(base)}/auth/session`, {
      method: 'POST',
      credentials: 'include',
      headers: jsonHeaders(playerAuthHeader),
      body: JSON.stringify({ username, password, delivery: 'cookie' }),
    });
    const status = await parseJsonResponse(res);
    scheduleRotation(base, status);
    return status;
  }

  async function rotateAuth(base) {
    const res = await fetch(`${assertSameOriginBase(base)}/auth/session`, {
      method: 'PATCH',
      credentials: 'include',
      headers: jsonHeaders(playerAuthHeader),
    });
    return parseJsonResponse(res);
  }

  async function logout(base) {
    const res = await fetch(`${assertSameOriginBase(base)}/auth/session`, {
      method: 'DELETE',
      credentials: 'include',
      headers: jsonHeaders(playerAuthHeader),
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
      'X-Bunnyland-Client-Id': browserClientId,
      ...(String(authHeader || '').startsWith('Bearer ') ? { Authorization: authHeader } : {}),
    };
  }

  function adminHeaders(authHeader = null, contentType = null) {
    const headers = { 'X-Bunnyland-Client-Id': browserClientId };
    if (contentType) headers['Content-Type'] = contentType;
    if (String(authHeader || '').startsWith('Bearer ')) {
      headers.Authorization = authHeader;
    }
    return headers;
  }

  function claimHeaders(control = null) {
    return {
      ...jsonHeaders(playerAuthHeader),
      'X-Bunnyland-Client-Id': control?.clientId || browserClientId,
      ...(control?.claimSecret ? { 'X-Bunnyland-Claim-Secret': control.claimSecret } : {}),
    };
  }

  async function parseJsonResponse(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.detail || `HTTP ${res.status}`, res.status);
    return data;
  }

  async function sendJson(base, path, { method = 'GET', body = null, headers = null, promptAuth = true } = {}) {
    const { data } = await sendJsonWithResponse(base, path, { method, body, headers, promptAuth });
    return data;
  }

  async function sendJsonWithResponse(base, path, {
    method = 'GET', body = null, headers = null, promptAuth = true,
  } = {}) {
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
    return { data: await parseJsonResponse(res), response: res };
  }

  async function promptPlayerAuth(base) {
    const credentials = await window.BunnylandUI.credentialsDialog({
      message: 'Enter your player credentials to continue.',
      title: 'Sign in to Bunnyland',
    });
    if (!credentials) return null;
    try {
      await login(base, credentials.username, credentials.password);
      return true;
    } catch (error) {
      await window.BunnylandUI.alertDialog(error.message || 'Login failed', {
        title: 'Sign in failed',
        tone: 'danger',
      });
      return false;
    }
  }

  function setPlayerAuth(authHeader = null) {
    playerAuthHeader = String(authHeader || '').startsWith('Bearer ') ? authHeader : null;
  }

  function getPlayerAuth() {
    return playerAuthHeader;
  }

  function setClientId(clientId) {
    const normalized = String(clientId || '').trim();
    if (normalized) browserClientId = normalized;
  }

  function getClientId() {
    return browserClientId;
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
    const path = `/admin/media/character/${encodeURIComponent(characterId)}/${encodeURIComponent(purpose)}`;
    const form = new FormData();
    form.append('file', file);
    const currentHeaders = () => adminHeaders(getAuth());
    let res = await fetch(`${assertSameOriginBase(base)}${path}`, {
      method: 'PUT',
      headers: currentHeaders(),
      body: form,
      credentials: 'include',
    });
    if (res.status === 401 && prompt) {
      if (await promptPlayerAuth(base)) {
        res = await fetch(`${assertSameOriginBase(base)}${path}`, {
          method: 'PUT',
          headers: currentHeaders(),
          body: form,
          credentials: 'include',
        });
      }
    }
    return parseJsonResponse(res);
  }

  function socketUrl(base, path = '/admin/world/stream', _authHeader = null) {
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
    void characterId;
    if (!control?.claimId) throw new Error('A character claim is required');
    return sendJson(base, `/play/claims/${encodeURIComponent(control.claimId)}/jobs`, {
      method: 'POST',
      headers: claimHeaders(control),
      body: JSON.stringify({ kind: 'scene_image' }),
    });
  }

  async function requestEventImage(base, recordId, extra = '') {
    return sendJson(base, '/admin/world/generation-jobs', {
      method: 'POST',
      body: JSON.stringify({ kind: 'image', entity_id: recordId, purpose: 'event', extra }),
    });
  }

  window.BunnylandApi = {
    ApiError,
    applyConfigToInput,
    applyServerParam,
    adminHeaders,
    assertSameOriginBase,
    authMe,
    claimHeaders,
    ensurePlayerAuth,
    getClientId,
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
    sendJsonWithResponse,
    serverFromUrl,
    setServerInUrl,
    setClientId,
    setPlayerAuth,
    socketUrl,
    rotateAuth,
    uploadCharacterImage,
  };
}());
