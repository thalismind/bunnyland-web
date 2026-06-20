(function () {
  'use strict';

  const KIND_ICON = {
    room: '🏠', character: '🐰', container: '📦', item: '✦',
    door: '🚪', food: '🍎', water: '💧', chair: '🪑', table: '🪵',
    bed: '🛏', art: '🖼', window: '🪟', other: '⬡',
  };

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
      worldEpoch: data.world_epoch || 0,
      room: data.room || {},
      inventory: data.inventory || [],
      points: data.points || {},
      controller: data.controller || null,
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
      })),
    };
  }

  function parseQueuedCommands(data) {
    if (!data || typeof data !== 'object' || !data.character_id) return null;
    return {
      characterId: data.character_id,
      worldEpoch: data.world_epoch || 0,
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

  function claimSettings({
    fallbackId = 'claim-fallback',
    timeoutId = 'claim-timeout',
    defaultMinutes = 30,
  } = {}) {
    const fallback = document.getElementById(fallbackId)?.value || 'suspend';
    const rawMinutes = Number(document.getElementById(timeoutId)?.value);
    const minutes = Number.isFinite(rawMinutes) ? Math.min(60, Math.max(5, rawMinutes)) : defaultMinutes;
    return { fallback_controller: fallback, timeout_seconds: Math.round(minutes * 60) };
  }

  function controlFromResponse(data, fallbackCharacterId = '') {
    if (!data) return null;
    return {
      characterId: data.character_id || fallbackCharacterId,
      controllerId: data.controller_id,
      generation: Number(data.controller_generation ?? data.generation ?? 0),
    };
  }

  function playerControl(control, projection, playerId) {
    if (control?.characterId === playerId) {
      return { controllerId: control.controllerId, generation: control.generation };
    }
    const projected = projection?.controller;
    if (projection?.characterId === playerId && projected) {
      return { controllerId: projected.controller_id, generation: projected.generation };
    }
    return null;
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
    return BunnylandApi.sendJson(base, '/world/events/recent');
  }

  async function fetchCharacterList(base) {
    return parseCharacterList(await BunnylandApi.sendJson(base, '/world/characters'));
  }

  async function fetchCharacterProjection(base, characterId) {
    return parseCharacterProjection(
      await BunnylandApi.sendJson(base, `/world/character/${encodeURIComponent(characterId)}`)
    );
  }

  async function fetchRoomProjection(base, roomId) {
    return parseRoomProjection(
      await BunnylandApi.sendJson(base, `/world/room/${encodeURIComponent(roomId)}`)
    );
  }

  async function fetchQueuedCommands(base, characterId) {
    return parseQueuedCommands(
      await BunnylandApi.sendJson(base, `/world/character/${encodeURIComponent(characterId)}/commands`)
    );
  }

  async function claimWebController(base, payload) {
    return BunnylandApi.sendJson(base, '/world/controllers/web/claim', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async function updateWebControllerFallback(base, payload) {
    return BunnylandApi.sendJson(base, '/world/controllers/web/fallback', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async function submitCommand(base, payload) {
    return BunnylandApi.sendJson(base, '/world/commands', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  const UNNARRATED_EVENT_TYPES = new Set([
    'CommandSubmittedEvent', 'CommandAcceptedEvent', 'CommandQueuedEvent',
    'CommandExecutedEvent', 'CommandExpiredEvent',
    'ActionPointsChangedEvent', 'FocusPointsChangedEvent', 'EncumbranceChangedEvent',
    'PainChangedEvent', 'BleedingChangedEvent', 'AttentionShiftedEvent', 'AffectChangedEvent',
    'EntitySeenEvent', 'RoomLookedEvent', 'RoomQualityUpdatedEvent', 'HungerChangedEvent',
    'ThirstChangedEvent', 'DailyNeedChangedEvent', 'SkillXPChangedEvent',
  ]);

  const EVENT_BASE_KEYS = new Set([
    'event_id', 'world_epoch', 'created_at', 'visibility', 'actor_id', 'room_id',
    'target_ids', 'causation_id', 'correlation_id', 'arrival_summary',
  ]);

  function humanizeEventType(eventType) {
    const name = String(eventType || 'Event').replace(/Event$/, '');
    return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
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
      return { text: String(event.arrival_summary), kind: 'event' };
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
      } else {
        details.push(`${key.replaceAll('_', ' ')} ${String(value)}`);
      }
    }
    const label = humanizeEventType(eventType);
    return {
      text: `${actor ? `${actor}: ` : ''}${label}${details.length ? ` - ${details.join('; ')}` : ''}`,
      kind: eventType === 'CommandRejectedEvent' ? 'rejection' : 'event',
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

  window.BunnylandPlay = {
    KIND_ICON,
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
    claimWebController,
    claimSettings,
    controlFromResponse,
    entityIcon,
    entityName,
    entityType,
    fetchCharacterList,
    fetchCharacterProjection,
    fetchQueuedCommands,
    fetchRecentEvents,
    fetchRoomProjection,
    filterActions,
    formatPoints,
    drainNarratedEvents,
    humanizeEventType,
    isReferenceArg,
    perceivesEvent,
    orderActionsByAvailability,
    parseCharacterList,
    parseCharacterProjection,
    parseQueuedCommands,
    parseRoomProjection,
    persistentClientId,
    playerControl,
    queuedCommandLabel,
    queuedCommandCost,
    queuedCommandDetail,
    queuedCommandName,
    renderEventLine,
    resolveTargetName,
    randomClientId,
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
