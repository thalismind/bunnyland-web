(function () {
  'use strict';

  const DEFAULT_KIND_ICONS = {
    region: '🌐',
    room: '🏠',
    character: '🐰',
    door: '🚪',
    quest: '📜',
    objective: '◻',
    reward: '🎁',
    container: '📦',
    item: '✦',
    clock: '◷',
    other: '⬡',
    food: '🍎',
    water: '💧',
    chair: '🪑',
    table: '🪵',
    bed: '🛏',
    art: '🖼',
    window: '🪟',
  };

  const CONTROL_STYLE = {
    llm:        { icon: '🤖', label: 'LLM',        color: '#89b4fa' },
    discord:    { icon: '🎮', label: 'Discord',    color: '#cba6f7' },
    mcp:        { icon: '🔌', label: 'MCP',        color: '#94e2d5' },
    behavioral: { icon: '🌳', label: 'Behavior',   color: '#a6e3a1' },
    scripted:   { icon: '📜', label: 'Script',     color: '#f9e2af' },
    web:        { icon: '⌨', label: 'Web',        color: '#74c7ec' },
    suspended:  { icon: '💤', label: 'Suspended',  color: '#6c7086' },
  };

  function emptyEntity(id) {
    return { id, prefab: 'entity', created_epoch: 0, components: {}, relationships: {} };
  }

  function normalizeSaveEdge(item) {
    return {
      target: item.target,
      edge: item.edge || {},
    };
  }

  function normalizeApiEdge(edge) {
    return {
      target: edge.target_id || edge.target,
      edge: edge.edge || {},
    };
  }

  function parseSaveSnapshot(json) {
    const entities = {};
    for (const [id, fields] of Object.entries(json.entities || {})) {
      entities[id] = {
        ...emptyEntity(id),
        prefab: fields.prefab || 'entity',
        created_epoch: fields.created_epoch || 0,
      };
    }
    for (const [ctype, table] of Object.entries(json.components || {})) {
      for (const [eid, fields] of Object.entries(table || {})) {
        if (!entities[eid]) entities[eid] = emptyEntity(eid);
        entities[eid].components[ctype] = fields || {};
      }
    }
    for (const [rtype, table] of Object.entries(json.relationships || {})) {
      for (const [eid, edges] of Object.entries(table || {})) {
        if (!entities[eid]) entities[eid] = emptyEntity(eid);
        entities[eid].relationships[rtype] = (edges || []).map(normalizeSaveEdge);
      }
    }
    return {
      metadata: json.metadata || { version: '1.0', epoch: 0 },
      meta: json.bunnyland || {},
      entities,
      epoch: json.metadata?.epoch || json.bunnyland?.saved_at_epoch || 0,
    };
  }

  function parseApiEntity(item) {
    const relationships = {};
    for (const [rtype, edges] of Object.entries(item.relationships || {})) {
      relationships[rtype] = (edges || []).map(normalizeApiEdge);
    }
    return {
      id: item.id,
      prefab: item.prefab || 'entity',
      created_epoch: item.created_epoch || 0,
      components: item.components || {},
      relationships,
    };
  }

  function parseApiSnapshot(json) {
    const entities = {};
    for (const item of json.entities || []) {
      entities[item.id] = parseApiEntity(item);
    }
    return {
      metadata: { version: '1.0', epoch: json.world_epoch || 0 },
      meta: json.metadata || {},
      entities,
      epoch: json.world_epoch || 0,
    };
  }

  function parseWorld(json) {
    if (Array.isArray(json.entities)) return parseApiSnapshot(json);
    return parseSaveSnapshot(json);
  }

  function exportWorld(world) {
    const out = {
      metadata: {
        version: world.metadata?.version || '1.0',
        epoch: Number(world.metadata?.epoch || world.epoch || 0),
      },
      bunnyland: {
        schema_version: 1,
        seed: '',
        prompt: '',
        generator: '',
        plugins: [],
        saved_at_epoch: Number(world.metadata?.epoch || world.epoch || 0),
        saved_at: null,
        ...(world.meta || {}),
      },
      prefabs: { entity: { components: {} } },
      entities: {},
      components: {},
      relationships: {},
      relics: [],
    };
    out.bunnyland.saved_at_epoch = Number(world.metadata?.epoch || out.bunnyland.saved_at_epoch || 0);
    for (const entity of Object.values(world.entities || {})) {
      out.entities[entity.id] = {
        prefab: entity.prefab || 'entity',
        created_epoch: Number(entity.created_epoch || 0),
      };
      for (const [ctype, fields] of Object.entries(entity.components || {})) {
        if (!out.components[ctype]) out.components[ctype] = {};
        out.components[ctype][entity.id] = fields || {};
      }
      for (const [rtype, edges] of Object.entries(entity.relationships || {})) {
        const clean = (edges || []).filter(edge => edge.target);
        if (!clean.length) continue;
        if (!out.relationships[rtype]) out.relationships[rtype] = {};
        out.relationships[rtype][entity.id] = clean.map(edge => ({
          target: edge.target,
          edge: edge.edge || {},
        }));
      }
    }
    return out;
  }

  function entityType(entity) {
    if (entity?.kind) return entity.kind;
    if (entity?.isCharacter) return 'character';
    const c = entity?.components || {};
    if (c.RegionComponent) return 'region';
    if (c.RoomComponent) return 'room';
    if (c.CharacterComponent) return 'character';
    if (c.DoorComponent) return 'door';
    if (c.QuestComponent) return 'quest';
    if (c.QuestObjectiveComponent) return 'objective';
    if (c.QuestRewardComponent) return 'reward';
    if (c.ContainerComponent) return 'container';
    if (c.PortableComponent) return 'item';
    if (c.WorldClockComponent) return 'clock';
    return 'other';
  }

  function entityDisplayName(entity, { maxFallback = 0 } = {}) {
    const c = entity?.components || {};
    let value = entity?.name || '';
    if (!value && c.RegionComponent) value = c.RegionComponent.name || '';
    if (!value && c.RoomComponent) value = c.RoomComponent.title || '';
    if (!value && c.QuestComponent) value = c.QuestComponent.title || c.QuestComponent.quest_id || '';
    if (!value && c.QuestObjectiveComponent) value = c.QuestObjectiveComponent.description || '';
    if (!value && c.QuestRewardComponent) value = c.QuestRewardComponent.description || '';
    if (!value && c.IdentityComponent?.name) value = c.IdentityComponent.name;
    if (!value) value = entity?.id || '';
    if (!maxFallback || value !== entity?.id || value.length <= maxFallback) return value;
    return value.slice(0, maxFallback);
  }

  function entityIcon(entity, icons = DEFAULT_KIND_ICONS) {
    const emoji = entity?.sprite?.emoji || entity?.components?.EditorDisplayComponent?.emoji;
    if (emoji) return emoji;
    const kind = entity?.kind || entity?.components?.IdentityComponent?.kind;
    return icons[kind] || icons[entityType(entity)] || icons.other;
  }

  function controllerInfo(controller) {
    if (!controller) return null;
    const c = controller.components || {};
    if (c.LLMControllerComponent) {
      const m = c.LLMControllerComponent;
      return { kind: 'llm', ...CONTROL_STYLE.llm, detail: [m.profile_name, m.model].filter(Boolean).join(' / ') };
    }
    if (c.DiscordControllerComponent) {
      const d = c.DiscordControllerComponent;
      return { kind: 'discord', ...CONTROL_STYLE.discord, detail: d.discord_user_id ? `user ${d.discord_user_id}` : '' };
    }
    if (c.MCPControllerComponent) {
      const m = c.MCPControllerComponent;
      return { kind: 'mcp', ...CONTROL_STYLE.mcp, detail: [m.label, m.agent_id].filter(Boolean).join(' / ') };
    }
    if (c.BehaviorControllerComponent) {
      const b = c.BehaviorControllerComponent;
      return { kind: 'behavioral', ...CONTROL_STYLE.behavioral, detail: b.behavior_name || '' };
    }
    if (c.ScriptedControllerComponent) {
      const s = c.ScriptedControllerComponent;
      return { kind: 'scripted', ...CONTROL_STYLE.scripted, detail: s.script_name || '' };
    }
    if (c.WebControllerComponent) {
      const w = c.WebControllerComponent;
      return { kind: 'web', ...CONTROL_STYLE.web, detail: [w.label, w.client_id].filter(Boolean).join(' / ') };
    }
    if (c.SuspendedControllerComponent) {
      const s = c.SuspendedControllerComponent;
      return { kind: 'suspended', ...CONTROL_STYLE.suspended, detail: s.reason || '' };
    }
    return null;
  }

  function controlInfo(entity, world) {
    const edges = entity?.relationships?.ControlledBy;
    if (!edges?.length) return null;
    return controllerInfo(world?.entities?.[edges[0].target]);
  }

  function componentNames(world, defaults = []) {
    const names = new Set(defaults);
    for (const entity of Object.values(world?.entities || {})) {
      for (const name of Object.keys(entity.components || {})) names.add(name);
    }
    return [...names].sort();
  }

  function edgeNames(world, defaults = []) {
    const names = new Set(defaults);
    for (const entity of Object.values(world?.entities || {})) {
      for (const name of Object.keys(entity.relationships || {})) names.add(name);
    }
    return [...names].sort();
  }

  function parseEntitySearch(query, { invalidToken = false } = {}) {
    const filters = [];
    const text = [];
    for (const token of String(query || '').trim().split(/\s+/).filter(Boolean)) {
      const match = token.match(/^([a-z]+):(.*)$/i);
      if (match) filters.push({ key: match[1].toLowerCase(), value: match[2].toLowerCase() });
      else text.push(token.toLowerCase());
    }
    const invalid = invalidToken && text.includes('invalid');
    const terms = invalid ? text.filter(token => token !== 'invalid') : text;
    return { filters, invalid, text: terms.join(' ') };
  }

  window.BunnylandWorld = {
    CONTROL_STYLE,
    DEFAULT_KIND_ICONS,
    componentNames,
    controlInfo,
    controllerInfo,
    edgeNames,
    entityDisplayName,
    entityIcon,
    entityType,
    exportWorld,
    parseApiEntity,
    parseApiSnapshot,
    parseEntitySearch,
    parseSaveSnapshot,
    parseSnapshot: parseSaveSnapshot,
    parseWorld,
  };
}());
