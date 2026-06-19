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

  window.BunnylandPlay = {
    KIND_ICON,
    actionArguments,
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
    fetchRoomProjection,
    parseCharacterList,
    parseCharacterProjection,
    parseQueuedCommands,
    parseRoomProjection,
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
