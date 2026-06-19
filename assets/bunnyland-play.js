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
    const match = actions.find(action => action.command_type === command?.command_type);
    const name = match ? actionTitle(match) : String(command?.command_type || 'command').replaceAll('-', ' ');
    const lane = command?.lane ? ` [${command.lane}]` : '';
    const details = [queuedCommandCost(command), queuedCommandDetail(command)].filter(Boolean);
    return `${name}${lane}${details.length ? ` - ${details.join(' · ')}` : ''}`;
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
    actionCommandType,
    actionCost,
    actionLane,
    actionTitle,
    actionTool,
    claimWebController,
    entityIcon,
    entityName,
    entityType,
    fetchCharacterList,
    fetchCharacterProjection,
    fetchQueuedCommands,
    fetchRecentEvents,
    fetchRoomProjection,
    formatPoints,
    drainNarratedEvents,
    humanizeEventType,
    perceivesEvent,
    parseCharacterList,
    parseCharacterProjection,
    parseQueuedCommands,
    parseRoomProjection,
    queuedCommandLabel,
    renderEventLine,
    submitCommand,
    targetIcon,
    updateWebControllerFallback,
  };

  Object.assign(window, {
    parseCharacterList,
    parseCharacterProjection,
    parseQueuedCommands,
    parseRoomProjection,
  });
}());
