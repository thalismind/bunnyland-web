(function () {
  'use strict';

  const KIND_ICON = {
    room: '🏠', character: '🐰', container: '📦', item: '✦',
    door: '🚪', food: '🍎', water: '💧', chair: '🪑', table: '🪵',
    bed: '🛏', art: '🖼', window: '🪟', other: '⬡',
  };

  // Mirror of the server's imagegen/affordance.py so the camera gesture reads the same
  // everywhere: the request/ack/deliver/fail emoji and the button label are one source of
  // truth shared by every web client. Keep these in lockstep with affordance.py.
  const IMAGE_AFFORDANCE = {
    REQUEST_EMOJI: '📷',
    ACK_EMOJI: '👀',
    DELIVER_EMOJI: '📸',
    FAIL_EMOJI: '⚠️',
    REQUEST_LABEL: 'Request image',
  };

  const ACTION_ICON_BY_COMMAND_TYPE = {
    look: '👁️', inspect: '🔎', move: '➡️', take: '🤲', put: '📥',
    drop: '📤', open: '🚪', close: '🚪', lock: '🔒', unlock: '🔓',
    hold: '✊', unhold: '🫳', wear: '🧥', remove: '🧥', use: '🛠️',
    write: '✍️', sleep: '💤', wake: '☀️', wait: '⏳', 'move-sprite': '🎯',
    say: '💬', tell: '🗣️', 'take-note': '📝', remember: '🧠',
    forget: '🧹', reflect: '💭', ignite: '🔥', extinguish: '🧯',
    'water-crop': '💧', eat: '🍽️', drink: '💧', craft: '🛠️',
    attack: '⚔️', defend: '🛡️', 'cast-spell': '✨', scan: '📡', jump: '🚀',
  };

  const ACTION_ICON_KEYWORDS = [
    ['move', '➡️'], ['travel', '🧭'], ['enter', '🚪'], ['leave', '🚪'],
    ['open', '🚪'], ['close', '🚪'], ['lock', '🔒'], ['unlock', '🔓'],
    ['search', '🔎'], ['inspect', '🔎'], ['scan', '📡'], ['survey', '🗺️'],
    ['study', '📚'], ['learn', '📚'], ['read', '📖'], ['write', '✍️'],
    ['say', '💬'], ['tell', '🗣️'], ['ask', '❓'], ['remember', '🧠'],
    ['reflect', '💭'], ['note', '📝'], ['take', '🤲'], ['collect', '🤲'],
    ['claim', '🏳️'], ['drop', '📤'], ['put', '📥'], ['store', '📥'],
    ['retrieve', '📤'], ['haul', '📦'], ['cargo', '📦'], ['deliver', '📦'],
    ['buy', '🛒'], ['sell', '🏷️'], ['trade', '🤝'], ['pay', '💰'],
    ['work', '💼'], ['job', '💼'], ['craft', '🛠️'], ['repair', '🛠️'],
    ['build', '🏗️'], ['upgrade', '⬆️'], ['install', '🔧'], ['machine', '⚙️'],
    ['power', '⚡'], ['water', '💧'], ['drink', '💧'], ['plant', '🌱'],
    ['harvest', '🌾'], ['forage', '🌿'], ['egg', '🥚'], ['feed', '🍽️'],
    ['eat', '🍽️'], ['potion', '⚗️'], ['chem', '⚗️'], ['heal', '🩹'],
    ['treat', '🩹'], ['poison', '☠️'], ['radiation', '☢️'], ['sample', '🧪'],
    ['mine', '⛏️'], ['salvage', '🔧'], ['quest', '📜'], ['faction', '🏳️'],
    ['crime', '⚖️'], ['jail', '⚖️'], ['bounty', '⚖️'], ['attack', '⚔️'],
    ['fight', '⚔️'], ['raid', '⚔️'], ['defeat', '⚔️'], ['defend', '🛡️'],
    ['trap', '🪤'], ['sneak', '🥷'], ['hide', '🥷'], ['steal', '🫴'],
    ['spell', '✨'], ['magic', '✨'], ['ritual', '✨'], ['dungeon', '🗝️'],
    ['map', '🗺️'], ['recall', '🌀'], ['rest', '💤'], ['sleep', '💤'],
    ['ship', '🚀'], ['orbit', '🪐'], ['drone', '🛰️'], ['ai', '🤖'],
    ['network', '📡'], ['hack', '💻'], ['exploit', '💻'], ['terminal', '💻'],
    ['credential', '🪪'], ['data', '💾'], ['evidence', '🧾'], ['camera', '📷'],
    ['sensor', '📡'], ['implant', '🦾'], ['call', '📣'], ['signal', '📣'],
    ['command', '📣'], ['assign', '📌'], ['set', '📌'], ['configure', '⚙️'],
    ['resolve', '✅'], ['complete', '✅'], ['accept', '✅'], ['decline', '✋'],
    ['cancel', '🚫'], ['release', '🫳'], ['clean', '🧼'], ['clear', '🧹'],
  ];

  function parseCharacterList(data) {
    return {
      epoch: data?.world_epoch || 0,
      characters: (data?.characters || []).map(c => ({
        id: c.character_id,
        name: c.name || c.character_id,
        kind: c.kind || 'character',
        suspended: Boolean(c.suspended),
      })),
    };
  }

  function targetIcon(kind) {
    if (kind === 'exit') return KIND_ICON.door;
    if (kind === 'object') return KIND_ICON.other;
    return KIND_ICON[kind] || KIND_ICON.other;
  }

  function parseCharacterProjection(data) {
    if (!data || typeof data !== 'object' || !data.character_id) return null;
    const targetGroups = {};
    for (const [kind, targets] of Object.entries(data.target_groups || {})) {
      targetGroups[kind] = (targets || []).map(target => ({
        value: target.id,
        label: target.label || target.id,
        kind: target.kind || kind,
        icon: targetIcon(target.kind),
      }));
    }
    return {
      characterId: data.character_id,
      characterName: data.character_name || data.character_id,
      worldEpoch: data.world_epoch || 0,
      room: data.room || {},
      inventory: data.inventory || [],
      points: data.points || {},
      controller: data.controller || null,
      portrait: data.portrait || {},
      sheet: data.sheet || {},
      targetGroups,
      actions: data.actions || [],
    };
  }

  function parseRoomProjection(data) {
    const room = data?.room;
    if (!room || !room.id) return null;
    return {
      worldEpoch: data.world_epoch || 0,
      room: {
        id: room.id,
        name: room.title || room.id,
        kind: 'room',
        isCharacter: false,
        defaultStart: Boolean(room.default_start),
        sprite: room.sprite || {},
        exits: (room.exits || []).map(exit => ({
          id: exit.id,
          direction: exit.direction || '',
          label: exit.label || exit.id,
          locked: Boolean(exit.locked),
        })),
      },
      entities: (room.entities || []).map(entity => ({
        id: entity.id,
        name: entity.name || entity.id,
        kind: entity.kind || 'other',
        isCharacter: Boolean(entity.is_character),
        sprite: entity.sprite || {},
        portrait: entity.portrait || {},
      })),
    };
  }

  function parseQueuedCommands(data) {
    if (!data || typeof data !== 'object' || !data.character_id) return null;
    return {
      characterId: data.character_id,
      worldEpoch: data.world_epoch || 0,
      generatedAtUnix: data.generated_at_unix ?? null,
      nextTickAtUnix: data.next_tick_at_unix ?? null,
      tickSeconds: data.tick_seconds ?? null,
      timeScale: data.time_scale ?? null,
      gameSecondsPerTick: data.game_seconds_per_tick ?? null,
      commands: data.commands || [],
    };
  }

  function entityType(entity) {
    if (entity?.kind) return entity.kind;
    if (entity?.isCharacter) return 'character';
    const c = entity?.components || {};
    if (c.RoomComponent) return 'room';
    if (c.CharacterComponent) return 'character';
    if (c.DoorComponent) return 'door';
    if (c.ContainerComponent) return 'container';
    if (c.PortableComponent) return 'item';
    return 'other';
  }

  function entityIcon(entity) {
    const emoji = entity?.sprite?.emoji || entity?.components?.EditorDisplayComponent?.emoji;
    if (emoji) return emoji;
    const kind = entity?.kind || entity?.components?.IdentityComponent?.kind;
    return KIND_ICON[kind] || KIND_ICON[entityType(entity)] || KIND_ICON.other;
  }

  function entityName(entity) {
    if (entity?.name) return entity.name;
    const c = entity?.components || {};
    if (c.RoomComponent) return c.RoomComponent.title || entity.id;
    return c.IdentityComponent?.name || entity?.id?.slice(0, 16) || '';
  }

  function actionTitle(action) {
    return String(action?.title || action?.tool_name || action?.command_type || 'Action');
  }

  function actionIcon(action) {
    if (action?.icon) return String(action.icon);
    const commandType = actionCommandType(action).trim().toLowerCase().replaceAll('_', '-');
    if (ACTION_ICON_BY_COMMAND_TYPE[commandType]) return ACTION_ICON_BY_COMMAND_TYPE[commandType];
    const tokens = commandType.split('-');
    const match = ACTION_ICON_KEYWORDS.find(([token]) => tokens.includes(token));
    return match ? match[1] : '•';
  }

  function actionTool(action) {
    return String(action?.tool_name || action?.command_type || 'action');
  }

  function actionCommandType(action) {
    return String(action?.command_type || actionTool(action));
  }

  function actionCost(action) {
    const cost = action?.cost || {};
    return { action: Number(cost.action || 0), focus: Number(cost.focus || 0) };
  }

  function actionLane(action) {
    return String(action?.lane || 'world');
  }

  function actionArguments(action) {
    return Array.isArray(action?.arguments) ? action.arguments : [];
  }

  function actionAvailable(action) {
    return action?.available !== false;
  }

  function actionUnavailableReason(action) {
    return actionAvailable(action) ? '' : String(action?.unavailable_reason || 'Unavailable right now');
  }

  function orderActionsByAvailability(actions) {
    return (actions || [])
      .map((action, index) => ({ action, index }))
      .sort((a, b) => {
        const aAvailable = actionAvailable(a.action) ? 0 : 1;
        const bAvailable = actionAvailable(b.action) ? 0 : 1;
        return aAvailable - bAvailable || a.index - b.index;
      })
      .map(item => item.action);
  }

  function filterActions(actions, query = '') {
    const q = String(query || '').trim().toLowerCase();
    const rows = q ? (actions || []).filter(action =>
      actionTitle(action).toLowerCase().includes(q) ||
      actionTool(action).toLowerCase().includes(q) ||
      actionCommandType(action).toLowerCase().includes(q)) : (actions || []);
    return orderActionsByAvailability(rows);
  }

  function formatPoints(value) {
    return Number.isInteger(Number(value)) ? String(Number(value)) : Number(value || 0).toFixed(1);
  }

  function queuedCommandCost(command) {
    const cost = command?.cost || {};
    const parts = [];
    if (cost.action) parts.push(`${cost.action} AP`);
    if (cost.focus) parts.push(`${cost.focus} FP`);
    return parts.length ? parts.join(' + ') : 'free';
  }

  function queuedCommandDetail(command) {
    const payload = command?.payload || {};
    return Object.entries(payload)
      .filter(([, value]) => value != null && value !== '')
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
  }

  function queuedCommandLabel(command, actions = []) {
    const name = queuedCommandName(command, actions);
    const lane = command?.lane ? ` [${command.lane}]` : '';
    const details = [queuedCommandCost(command), queuedCommandDetail(command)].filter(Boolean);
    return `${name}${lane}${details.length ? ` - ${details.join(' · ')}` : ''}`;
  }

  function queuedCommandName(command, actions = []) {
    const match = actions.find(action => action.command_type === command?.command_type);
    return match ? actionTitle(match) : String(command?.command_type || 'command').replaceAll('-', ' ');
  }

  function randomClientId(prefix = 'web') {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) {
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
      return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function persistentClientId(key, prefix = 'web') {
    try {
      let clientId = localStorage.getItem(key);
      if (!clientId) {
        clientId = randomClientId(prefix);
        localStorage.setItem(key, clientId);
      }
      return clientId;
    } catch (_err) {
      return randomClientId(prefix);
    }
  }

  function iconPreference(key, defaultValue = true) {
    try {
      const value = localStorage.getItem(key);
      return value == null ? Boolean(defaultValue) : value !== 'false';
    } catch (_err) {
      return Boolean(defaultValue);
    }
  }

  function setIconPreference(key, value) {
    try {
      localStorage.setItem(key, value ? 'true' : 'false');
    } catch (_err) {
      // Best-effort preference only.
    }
  }

  function claimSettings({
    fallbackId = 'claim-fallback',
    fallbackControllerId = 'claim-fallback-controller',
    timeoutId = 'claim-timeout',
    defaultMinutes = 30,
  } = {}) {
    const selectedFallback = document.getElementById(fallbackId)?.value || 'suspend';
    const customFallback = document.getElementById(fallbackControllerId)?.value?.trim() || '';
    const fallback = selectedFallback === 'controller' ? customFallback : selectedFallback;
    const rawMinutes = Number(document.getElementById(timeoutId)?.value);
    const minutes = Number.isFinite(rawMinutes) ? Math.min(60, Math.max(5, rawMinutes)) : defaultMinutes;
    return { fallback_controller: fallback, timeout_seconds: Math.round(minutes * 60) };
  }

  function controlFromResponse(data, fallbackCharacterId = '', { active = true } = {}) {
    if (!data) return null;
    return {
      characterId: data.character_id || fallbackCharacterId,
      controllerId: data.controller_id,
      generation: Number(data.controller_generation ?? data.generation ?? 0),
      claimId: data.claim_id || '',
      claimSecret: data.claim_secret || '',
      active,
    };
  }

  function syncClaimControl(control, projection, playerId) {
    const projected = projection?.characterId === playerId ? projection?.controller : null;
    if (!control?.characterId || control.characterId !== playerId || !projected) return null;
    const next = {
      characterId: control.characterId,
      controllerId: projected.controller_id,
      generation: Number(projected.generation || 0),
      claimId: control.claimId || '',
      claimSecret: control.claimSecret || '',
      active: projected.controller_id === control.controllerId && control.active !== false,
    };
    if (next.claimId && next.claimSecret) return next;
    return projected.controller_id === control.controllerId ? next : null;
  }

  function playerControl(control, projection, playerId) {
    if (control?.active === false) return null;
    const projected = projection?.characterId === playerId ? projection?.controller : null;
    if (
      control?.characterId === playerId &&
      projected?.controller_id === control.controllerId
    ) {
      const next = {
        controllerId: control.controllerId,
        generation: Number(projected.generation || 0),
      };
      if (control.claimId) next.claimId = control.claimId;
      if (control.claimSecret) next.claimSecret = control.claimSecret;
      return next;
    }
    return null;
  }

  function claimStorageKey(key, characterId) {
    return `${key}.claim.${characterId}`;
  }

  function storedClaimControl(key, characterId) {
    try {
      const data = JSON.parse(localStorage.getItem(claimStorageKey(key, characterId)) || '{}');
      if (!data.controllerId || !data.claimId || !data.claimSecret) return null;
      return {
        characterId,
        controllerId: data.controllerId,
        generation: Number(data.generation || 0),
        claimId: data.claimId,
        claimSecret: data.claimSecret,
        active: data.active !== false,
      };
    } catch (_err) {
      return null;
    }
  }

  function storeClaimControl(key, control) {
    if (!key || !control?.characterId || !control?.claimId || !control?.claimSecret) return;
    try {
      localStorage.setItem(claimStorageKey(key, control.characterId), JSON.stringify({
        controllerId: control.controllerId,
        generation: control.generation,
        claimId: control.claimId,
        claimSecret: control.claimSecret,
        active: control.active !== false,
      }));
    } catch (_err) {
      // Best-effort continuity only.
    }
  }

  function clearClaimControl(key, characterId) {
    if (!key || !characterId) return;
    try {
      localStorage.removeItem(claimStorageKey(key, characterId));
    } catch (_err) {
      // Best-effort continuity only.
    }
  }

  function claimParams(control) {
    const params = new URLSearchParams();
    if (control?.claimId) params.set('claim_id', control.claimId);
    return params;
  }

  function claimQuery(control) {
    const params = claimParams(control);
    const query = params.toString();
    return query ? `?${query}` : '';
  }

  function allTargets(projection) {
    const targets = [];
    const seen = new Set();
    const add = (value, label, kind = '') => {
      if (!value || seen.has(value)) return;
      seen.add(value);
      targets.push({ value, label: label || value, kind });
    };
    for (const group of Object.values(projection?.targetGroups || {})) {
      for (const item of group || []) add(item.value, item.label, item.kind);
    }
    for (const entity of projection?.room?.entities || []) {
      add(entity.id, entity.name || entity.label || entity.id, entity.kind);
    }
    for (const exit of projection?.room?.exits || []) {
      add(exit.id, exit.direction || exit.label || exit.id, 'exit');
    }
    for (const item of projection?.inventory || []) {
      add(item.id, item.label || item.name || item.id, item.kind);
    }
    return targets;
  }

  function targetCandidates(projection, arg) {
    if (arg?.target_group && projection?.targetGroups?.[arg.target_group]) {
      return projection.targetGroups[arg.target_group];
    }
    return allTargets(projection);
  }

  function actionFields(action, targetCandidateFn) {
    return actionArguments(action)
      .filter(arg => arg.key && (arg.required || arg.target_group))
      .map(arg => ({
        key: arg.key,
        label: arg.title || arg.key,
        kind: arg.kind || 'string',
        required: Boolean(arg.required),
        candidates: arg.target_group ? targetCandidateFn(arg.target_group, arg) : null,
      }));
  }

  function isReferenceArg(arg) {
    return arg?.kind === 'entity' || Boolean(arg?.target_group) || String(arg?.key || '').endsWith('_id');
  }

  function resolveTargetName(value, candidates) {
    if ((candidates || []).some(c => c.value === value)) return candidates.find(c => c.value === value);
    const query = String(value || '').trim().toLowerCase();
    if (!query) return null;
    const normalize = (text) => String(text || '').trim().toLowerCase().replace(/^(a|an|the)\s+/, '');
    return (candidates || []).find(c => String(c.label).toLowerCase() === query || normalize(c.label) === query) ||
      (candidates || []).slice()
        .sort((a, b) => String(a.label).length - String(b.label).length || String(a.label).localeCompare(String(b.label)))
        .find(c => String(c.label).toLowerCase().startsWith(query) || normalize(c.label).startsWith(query)) || null;
  }

  function suggestTargetNames(value, candidates) {
    const query = String(value || '').trim().toLowerCase();
    if (!query) return [];
    return (candidates || [])
      .map(c => String(c.label))
      .filter(label => label.toLowerCase().includes(query.slice(0, 3)))
      .slice(0, 3);
  }

  function targetPrefix(rest, candidates) {
    const lower = String(rest || '').toLowerCase();
    const sorted = (candidates || []).slice().sort((a, b) => String(b.label).length - String(a.label).length);
    for (const candidate of sorted) {
      const label = String(candidate.label);
      if (lower === label.toLowerCase()) return { raw: label, remaining: '' };
      if (lower.startsWith(`${label.toLowerCase()} `)) {
        return { raw: label, remaining: String(rest).slice(label.length).trim() };
      }
    }
    const [first, ...restParts] = String(rest || '').split(/\s+/);
    if (first) return { raw: first, remaining: restParts.join(' ') };
    return null;
  }

  async function fetchRecentEvents(base) {
    return BunnylandApi.sendJson(base, '/admin/world/events/recent');
  }

  async function fetchCharacterRecentEvents(base, characterId, control = null) {
    return BunnylandApi.sendJson(
      base,
      `/play/world/character/${encodeURIComponent(characterId)}/events/recent${claimQuery(control)}`,
      { headers: BunnylandApi.claimHeaders(control) }
    );
  }

  const PLAYER_FRAME_TYPES = new Set(['ready', 'event', 'invalidate', 'resync', 'heartbeat']);
  const RECONNECT_SECONDS = [1, 2, 4, 8, 16, 30];
  const SEEN_EVENT_LIMIT = 512;

  function openPlayerUpdates({
    base,
    characterId,
    control = null,
    onFrame,
    onOpen = () => {},
    onClose = () => {},
    onError = () => {},
    onAnyFrame = () => {},
    webSocketFactory = null,
  }) {
    const factory = webSocketFactory || (
      typeof WebSocket === 'function' ? url => new WebSocket(url) : null
    );
    if (!factory) return null;
    const path = `/play/world/character/${encodeURIComponent(characterId)}/updates`;
    const socket = factory(BunnylandApi.socketUrl(base, path, BunnylandApi.getPlayerAuth()));
    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: 'authenticate',
        data: {
          token: BunnylandApi.getPlayerAuth()?.startsWith('Bearer ')
            ? BunnylandApi.getPlayerAuth().slice(7)
            : null,
          claim_id: control?.claimId || null,
          claim_secret: control?.claimSecret || null,
        },
      }));
      onOpen();
    };
    socket.onmessage = event => {
      onAnyFrame();
      let frame;
      try {
        frame = JSON.parse(String(event.data ?? ''));
      } catch (_err) {
        return;
      }
      if (!frame || typeof frame !== 'object' || !PLAYER_FRAME_TYPES.has(frame.type) ||
          !frame.data || typeof frame.data !== 'object') return;
      onFrame(frame);
    };
    socket.onclose = onClose;
    socket.onerror = onError;
    return socket;
  }

  function createPlayerLiveUpdates({
    base,
    characterId,
    control = null,
    refresh,
    onFrame = () => {},
    onState = () => {},
    webSocketFactory = null,
    random = Math.random,
  }) {
    let closed = false;
    let state = 'connecting';
    let socket = null;
    let generation = 0;
    let reconnectAttempt = 0;
    let reconnectTimer = null;
    let pollTimer = null;
    let heartbeatTimer = null;
    let refreshTimer = null;
    let refreshing = false;
    let refreshPending = false;
    let lastStreamSequence = 0;
    const seenEventIds = new Set();
    const seenEventOrder = [];
    const setState = next => {
      if (state === next) return;
      state = next;
      onState(next);
    };
    const clearHeartbeat = () => {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    };
    const runRefresh = async () => {
      refreshTimer = null;
      if (closed) return;
      if (refreshing) {
        refreshPending = true;
        return;
      }
      refreshing = true;
      try {
        await refresh();
      } catch (_err) {
        // Keep later polls and live frames active after a transient HTTP failure.
      } finally {
        refreshing = false;
        if (refreshPending && !closed) {
          refreshPending = false;
          void runRefresh();
        }
      }
    };
    const requestRefresh = (delay = 0) => {
      if (closed) return;
      if (refreshing) {
        refreshPending = true;
        return;
      }
      if (refreshTimer != null) return;
      refreshTimer = setTimeout(() => { void runRefresh(); }, delay);
    };
    const stopPolling = () => {
      clearInterval(pollTimer);
      pollTimer = null;
    };
    const startPolling = () => {
      if (closed || pollTimer != null) return;
      requestRefresh();
      pollTimer = setInterval(() => requestRefresh(), 2000);
    };
    const scheduleHeartbeat = token => {
      clearHeartbeat();
      heartbeatTimer = setTimeout(() => {
        if (closed || token !== generation) return;
        const stale = socket;
        socket = null;
        generation += 1;
        stale?.close();
        disconnected();
      }, 70000);
    };
    const scheduleReconnect = () => {
      if (closed || reconnectTimer != null) return;
      const seconds = RECONNECT_SECONDS[Math.min(reconnectAttempt, RECONNECT_SECONDS.length - 1)];
      reconnectAttempt += 1;
      const delay = seconds * 1000 * (0.8 + random() * 0.4);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };
    const disconnected = () => {
      if (closed) return;
      clearHeartbeat();
      setState('fallback');
      startPolling();
      scheduleReconnect();
    };
    const connect = () => {
      if (closed) return;
      const token = ++generation;
      lastStreamSequence = 0;
      setState('connecting');
      startPolling();
      const opened = openPlayerUpdates({
        base,
        characterId,
        control,
        webSocketFactory,
        onOpen: () => {
          if (!closed && token === generation) scheduleHeartbeat(token);
        },
        onAnyFrame: () => {
          if (!closed && token === generation) scheduleHeartbeat(token);
        },
        onFrame: frame => {
          if (closed || token !== generation) return;
          const sequence = Number(frame.stream_sequence || 0);
          const sequenceGap = sequence > 0 && lastStreamSequence > 0
            && sequence !== lastStreamSequence + 1;
          if (sequence > 0) lastStreamSequence = sequence;

          const eventId = typeof frame.event_id === 'string' ? frame.event_id : '';
          if (eventId && seenEventIds.has(eventId)) return;
          if (eventId) {
            seenEventIds.add(eventId);
            seenEventOrder.push(eventId);
            if (seenEventOrder.length > SEEN_EVENT_LIMIT) {
              seenEventIds.delete(seenEventOrder.shift());
            }
          }

          onFrame(frame);
          if (frame.type === 'ready') {
            reconnectAttempt = 0;
            stopPolling();
            setState('live');
          } else if (frame.type === 'resync' || sequenceGap) {
            requestRefresh();
          } else if (frame.type !== 'heartbeat') {
            requestRefresh(150);
          }
        },
        onClose: () => {
          if (closed || token !== generation) return;
          socket = null;
          disconnected();
        },
        onError: () => {
          if (closed || token !== generation) return;
          const failed = socket;
          socket = null;
          generation += 1;
          failed?.close();
          disconnected();
        },
      });
      if (closed || token !== generation) {
        opened?.close();
        return;
      }
      socket = opened;
      if (!opened) disconnected();
    };
    onState(state);
    connect();
    return {
      close() {
        if (closed) return;
        closed = true;
        generation += 1;
        clearTimeout(reconnectTimer);
        clearTimeout(refreshTimer);
        reconnectTimer = null;
        refreshTimer = null;
        stopPolling();
        clearHeartbeat();
        const current = socket;
        socket = null;
        current?.close();
        setState('closed');
      },
      getState: () => state,
    };
  }

  async function fetchCharacterList(base) {
    return parseCharacterList(await BunnylandApi.sendJson(base, '/play/world/characters'));
  }

  async function fetchCharacterProjection(base, characterId, control = null) {
    return parseCharacterProjection(
      await BunnylandApi.sendJson(
        base,
        `/play/world/character/${encodeURIComponent(characterId)}${claimQuery(control)}`,
        { headers: BunnylandApi.claimHeaders(control) }
      )
    );
  }

  async function fetchRoomProjection(base, roomId, characterId, control = null) {
    const params = claimParams(control);
    params.set('character_id', characterId);
    return parseRoomProjection(
      await BunnylandApi.sendJson(
        base,
        `/play/world/room/${encodeURIComponent(roomId)}?${params.toString()}`,
        { headers: BunnylandApi.claimHeaders(control) }
      )
    );
  }

  async function fetchQueuedCommands(base, characterId, control = null) {
    return parseQueuedCommands(
      await BunnylandApi.sendJson(
        base,
        `/play/world/character/${encodeURIComponent(characterId)}/commands${claimQuery(control)}`,
        { headers: BunnylandApi.claimHeaders(control) }
      )
    );
  }

  async function cancelQueuedCommand(base, characterId, commandId, control) {
    const params = new URLSearchParams({
      controller_id: control?.controllerId || '',
      controller_generation: String(control?.generation ?? 0),
    });
    if (control?.claimId) params.set('claim_id', control.claimId);
    return BunnylandApi.sendJson(
      base,
      `/play/world/character/${encodeURIComponent(characterId)}/commands/${encodeURIComponent(commandId)}?${params}`,
      { method: 'DELETE', headers: BunnylandApi.claimHeaders(control) }
    );
  }

  async function claimWebController(base, payload, control = null) {
    return BunnylandApi.sendJson(base, '/play/world/controllers/web/claim', {
      method: 'POST',
      headers: BunnylandApi.claimHeaders(control),
      body: JSON.stringify(payload),
    });
  }

  async function updateWebControllerFallback(base, payload, control = null) {
    return BunnylandApi.sendJson(base, '/play/world/controllers/web/fallback', {
      method: 'PATCH',
      headers: BunnylandApi.claimHeaders(control),
      body: JSON.stringify(payload),
    });
  }

  async function releaseWebController(base, payload, control = null) {
    return BunnylandApi.sendJson(base, '/play/world/controllers/web/release-controller', {
      method: 'POST',
      headers: BunnylandApi.claimHeaders(control),
      body: JSON.stringify(payload),
    });
  }

  async function releaseWebClaim(base, payload, control = null) {
    return BunnylandApi.sendJson(base, '/play/world/controllers/web/release-claim', {
      method: 'POST',
      headers: BunnylandApi.claimHeaders(control),
      body: JSON.stringify(payload),
    });
  }

  async function submitCommand(base, payload, control = null) {
    return BunnylandApi.sendJson(base, '/play/world/commands', {
      method: 'POST',
      headers: BunnylandApi.claimHeaders(control),
      body: JSON.stringify(payload),
    });
  }

  function queuedCountdownSeconds(queueProjection) {
    const nextTick = queueProjection?.nextTickAtUnix;
    if (nextTick == null) return null;
    return Math.max(0, Math.round(Number(nextTick) - Date.now() / 1000));
  }

  const UNNARRATED_EVENT_TYPES = new Set([
    'CommandSubmittedEvent', 'CommandAcceptedEvent', 'CommandQueuedEvent',
    'CommandCancelledEvent',
    'CommandExecutedEvent', 'CommandExpiredEvent',
    'ActionPointsChangedEvent', 'FocusPointsChangedEvent', 'EncumbranceChangedEvent',
    'PainChangedEvent', 'BleedingChangedEvent', 'AttentionShiftedEvent', 'AffectChangedEvent',
    'EntitySeenEvent', 'RoomQualityUpdatedEvent', 'HungerChangedEvent',
    'ThirstChangedEvent', 'DailyNeedChangedEvent', 'SkillXPChangedEvent',
  ]);

  const SYSTEM_EVENT_TYPES = new Set([
    'ControllerChangedEvent',
    'WorldPauseStatusChangedEvent',
  ]);

  const EVENT_ICON_BY_TYPE = {
    ActorMovedEvent: '➡️',
    RoomLookedEvent: '👁️',
    CommandRejectedEvent: '⚠️',
    ControllerChangedEvent: '🎮',
    WorldPauseStatusChangedEvent: '⏸️',
    CharacterClaimedEvent: '🎮',
  };

  const EVENT_BASE_KEYS = new Set([
    'event_id', 'world_epoch', 'created_at', 'visibility', 'actor_id', 'room_id',
    'target_ids', 'causation_id', 'correlation_id', 'arrival_summary',
  ]);

  function humanizeEventType(eventType) {
    const name = String(eventType || 'Event').replace(/Event$/, '');
    return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
  }

  function eventIcon(eventType, event = {}) {
    if (eventType === 'CommandRejectedEvent' && event.command_type) {
      return actionIcon({ command_type: event.command_type });
    }
    return EVENT_ICON_BY_TYPE[eventType] || '•';
  }

  function perceivesEvent(event, { playerId = '', roomOf = () => null } = {}) {
    const visibility = event?.visibility;
    if (visibility === 'public') return true;
    if (visibility === 'room') return Boolean(playerId) && event.room_id === roomOf(playerId);
    if (visibility === 'directed') {
      return Boolean(playerId) && (
        event.actor_id === playerId || (event.target_ids || []).includes(playerId)
      );
    }
    if (visibility === 'private') return Boolean(playerId) && event.actor_id === playerId;
    return false;
  }

  function renderEventLine(data, { playerId = '', nameFor = () => null } = {}) {
    const event = data?.event || {};
    const eventType = String(data?.event_type || 'Event');
    if (eventType === 'ActorMovedEvent' && playerId &&
        event.actor_id === playerId && event.arrival_summary) {
      return { text: String(event.arrival_summary), kind: 'event', icon: eventIcon(eventType, event) };
    }
    if (eventType === 'RoomLookedEvent' && event.summary) {
      return { text: String(event.summary), kind: 'event', icon: eventIcon(eventType, event) };
    }
    const actor = event.actor_id ? nameFor(event.actor_id) : null;
    const details = [];
    for (const [key, value] of Object.entries(event)) {
      if (EVENT_BASE_KEYS.has(key) || value == null || value === '' ||
          (Array.isArray(value) && !value.length)) continue;
      if (key.endsWith('_ids') && Array.isArray(value)) {
        const names = value.map(item => nameFor(String(item))).filter(Boolean);
        if (names.length) details.push(names.join(', '));
      } else if (key.endsWith('_id')) {
        const name = nameFor(String(value));
        if (name) details.push(name);
      } else if (key === 'facts' && Array.isArray(value)) {
        details.push(...value.flatMap(fact => {
          if (!fact || typeof fact !== 'object' || !('text' in fact)) return [];
          const text = String(fact.text || '').trim();
          return text ? [text] : [];
        }));
      } else {
        details.push(`${key.replaceAll('_', ' ')} ${String(value)}`);
      }
    }
    const label = humanizeEventType(eventType);
    return {
      text: `${actor ? `${actor}: ` : ''}${label}${details.length ? ` - ${details.join('; ')}` : ''}`,
      kind: eventType === 'CommandRejectedEvent'
        ? 'rejection'
        : SYSTEM_EVENT_TYPES.has(eventType) ? 'system' : 'event',
      icon: eventIcon(eventType, event),
    };
  }

  function drainNarratedEvents(messages, {
    seenIds = new Set(),
    playerId = '',
    roomOf = () => null,
    nameFor = () => null,
  } = {}) {
    const current = new Set(seenIds);
    const lines = [];
    for (const message of messages || []) {
      const data = message.data || message;
      const event = data.event || {};
      const eventId = event.event_id;
      if (!eventId) continue;
      current.add(eventId);
      if (seenIds.has(eventId)) continue;
      const eventType = data.event_type || 'Event';
      if (UNNARRATED_EVENT_TYPES.has(eventType)) continue;
      const own = playerId && event.actor_id === playerId;
      if (own || perceivesEvent(event, { playerId, roomOf })) {
        lines.push(renderEventLine(data, { playerId, nameFor }));
      }
    }
    return { lines, seenIds: current };
  }

  function inventoryEntries(projection) {
    // Normalize a character projection's carried items into display rows (id, label, kind,
    // icon). Shared by the inventory views so every client lists the same thing the same way.
    return (projection?.inventory || []).map(item => ({
      id: item.id,
      label: item.label || item.id,
      kind: item.kind || '',
      icon: entityIcon(item),
    }));
  }

  function imageRequestMessage(result) {
    if (!result || result.ok === false) {
      return `${IMAGE_AFFORDANCE.REQUEST_EMOJI} ${(result && result.reason) || 'image request failed'}`;
    }
    if (result.status === 'skipped') return `${IMAGE_AFFORDANCE.DELIVER_EMOJI} image ready`;
    return `${IMAGE_AFFORDANCE.ACK_EMOJI} image requested`;
  }

  function imageCompletionFromMessage(message, base = '') {
    const data = message?.data || message || {};
    if (data.event_type !== 'ImageGenerationCompletedEvent') return null;
    const event = data.event || {};
    if (!event.url) return null;
    return {
      entityId: String(event.entity_id || ''),
      purpose: String(event.purpose || ''),
      url: BunnylandApi.mediaUrl(base, event.url),
      alphaUrl: event.alpha_url ? BunnylandApi.mediaUrl(base, event.alpha_url) : '',
      epoch: Number(event.world_epoch || 0),
    };
  }

  function latestImageCompletion(messages, { base = '', purpose = '' } = {}) {
    let best = null;
    for (const message of messages || []) {
      const image = imageCompletionFromMessage(message, base);
      if (!image) continue;
      if (purpose && image.purpose !== purpose) continue;
      if (!best || image.epoch >= best.epoch) best = image;
    }
    return best;
  }

  function imageFailureFromMessage(message) {
    const data = message?.data || message || {};
    if (data.event_type !== 'ImageGenerationFailedEvent') return null;
    const event = data.event || {};
    return {
      entityId: String(event.entity_id || ''),
      purpose: String(event.purpose || ''),
      reason: String(event.reason || 'image generation failed'),
      epoch: Number(event.world_epoch || 0),
    };
  }

  function latestImageFailure(messages, { purpose = '' } = {}) {
    let best = null;
    for (const message of messages || []) {
      const failure = imageFailureFromMessage(message);
      if (!failure) continue;
      if (purpose && failure.purpose !== purpose) continue;
      if (!best || failure.epoch >= best.epoch) best = failure;
    }
    return best;
  }

  function characterSheetHref(apiBase, characterId, page = 'character-sheet.html') {
    const url = new URL(page, location.href);
    if (url.origin !== location.origin) {
      throw new Error('Bunnyland browser links must use the page origin');
    }
    const normalized = BunnylandApi.assertSameOriginBase(apiBase);
    if (normalized) url.searchParams.set('server', normalized);
    else url.searchParams.delete('server');
    url.hash = characterId || '';
    return `${url.pathname.split('/').pop()}${url.search}${url.hash}`;
  }

  function portraitStatusMessage(projection, requestState = '') {
    if (projection?.portrait?.url) return 'Portrait ready.';
    if (requestState === 'requesting') return 'Requesting portrait...';
    if (requestState === 'queued') return 'Portrait generation queued.';
    if (requestState === 'failed') return 'Portrait generation unavailable.';
    return 'Portrait pending.';
  }

  window.BunnylandPlay = {
    KIND_ICON,
    IMAGE_AFFORDANCE,
    actionIcon,
    actionArguments,
    actionAvailable,
    actionCommandType,
    actionCost,
    actionFields,
    actionLane,
    actionTitle,
    actionTool,
    actionUnavailableReason,
    allTargets,
    cancelQueuedCommand,
    claimWebController,
    clearClaimControl,
    storedClaimControl,
    storeClaimControl,
    claimSettings,
    controlFromResponse,
    syncClaimControl,
    entityIcon,
    entityName,
    entityType,
    fetchCharacterList,
    fetchCharacterRecentEvents,
    fetchCharacterProjection,
    fetchQueuedCommands,
    fetchRecentEvents,
    fetchRoomProjection,
    filterActions,
    formatPoints,
    characterSheetHref,
    drainNarratedEvents,
    eventIcon,
    humanizeEventType,
    iconPreference,
    imageCompletionFromMessage,
    imageFailureFromMessage,
    imageRequestMessage,
    inventoryEntries,
    latestImageCompletion,
    latestImageFailure,
    openPlayerUpdates,
    createPlayerLiveUpdates,
    isReferenceArg,
    perceivesEvent,
    orderActionsByAvailability,
    parseCharacterList,
    parseCharacterProjection,
    parseQueuedCommands,
    parseRoomProjection,
    persistentClientId,
    portraitStatusMessage,
    playerControl,
    queuedCommandLabel,
    queuedCommandCost,
    queuedCommandDetail,
    queuedCommandName,
    queuedCountdownSeconds,
    renderEventLine,
    resolveTargetName,
    randomClientId,
    releaseWebClaim,
    releaseWebController,
    setIconPreference,
    suggestTargetNames,
    submitCommand,
    targetCandidates,
    targetIcon,
    targetPrefix,
    updateWebControllerFallback,
  };

  Object.assign(window, {
    parseCharacterList,
    parseCharacterProjection,
    parseQueuedCommands,
    parseRoomProjection,
  });
}());
