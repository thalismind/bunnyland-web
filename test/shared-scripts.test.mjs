import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadBrowserAssets(files) {
  const context = {
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    console,
    document: {
      getElementById: () => null,
    },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    globalThis: null,
    history: { replaceState: () => {} },
    location: {
      href: 'http://example.test/index.html',
      origin: 'http://example.test',
      pathname: '/index.html',
      search: '',
    },
    localStorage: new MapStorage(),
    URL,
    URLSearchParams,
    window: null,
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  for (const file of files) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
  return context;
}

class MapStorage {
  constructor() {
    this.items = new Map();
  }

  getItem(key) {
    return this.items.has(key) ? this.items.get(key) : null;
  }

  setItem(key, value) {
    this.items.set(key, String(value));
  }
}

test('BunnylandApi normalizes URLs and websocket endpoints', () => {
  const { BunnylandApi } = loadBrowserAssets(['assets/bunnyland-api.js']);

  assert.equal(BunnylandApi.normalizeBase(' http://server.test/api/ '), 'http://server.test/api');
  assert.equal(BunnylandApi.socketUrl('https://server.test/api/', '/world/updates'), 'wss://server.test/api/world/updates');
});

test('Character chat page is in the client menu and sends bounded local history', () => {
  const ui = fs.readFileSync('assets/bunnyland-ui.js', 'utf8');
  const page = fs.readFileSync('character-chat.html', 'utf8');

  assert.match(ui, /character-chat\.html/);
  assert.match(page, /const HISTORY_LIMIT = 24/);
  assert.match(page, /history: historyForPayload\(state\.messages\)/);
  assert.match(page, /chat\/pending\/\$\{encodeURIComponent\(commandId\)\}/);
  assert.match(page, /localStorage\.setItem\(storageKey\(characterId\)/);
  assert.match(page, /\/world\/character\/\$\{encodeURIComponent\(characterId\)\}\/chat/);
});

test('BunnylandWorld parses snapshots and editor search tokens', () => {
  const { BunnylandWorld } = loadBrowserAssets(['assets/bunnyland-world.js']);

  const world = BunnylandWorld.parseWorld({
    metadata: { version: '1.0', epoch: 7 },
    entities: { room1: { prefab: 'room', created_epoch: 1 } },
    components: { RoomComponent: { room1: { title: 'Kitchen' } } },
    relationships: {},
  });

  assert.equal(world.epoch, 7);
  assert.equal(BunnylandWorld.entityType(world.entities.room1), 'room');
  assert.equal(BunnylandWorld.entityDisplayName(world.entities.room1), 'Kitchen');
  assert.deepEqual(
    plain(BunnylandWorld.parseEntitySearch('invalid type:room kitchen', { invalidToken: true })),
    { filters: [{ key: 'type', value: 'room' }], invalid: true, text: 'kitchen' },
  );
});

test('BunnylandPlay normalizes projections, filters actions, and drains events', () => {
  const { BunnylandPlay } = loadBrowserAssets([
    'assets/bunnyland-api.js',
    'assets/bunnyland-play.js',
  ]);

  const projection = BunnylandPlay.parseCharacterProjection({
    character_id: 'character:1',
    world_epoch: 12,
    room: {
      id: 'room:1',
      entities: [{ id: 'item:1', name: 'Brass Key', kind: 'item' }],
      exits: [{ id: 'room:2', direction: 'north', label: 'Hallway' }],
    },
    inventory: [{ id: 'item:2', label: 'Lantern', kind: 'item' }],
    controller: { controller_id: 'web:1', generation: 4 },
    sheet: { species: 'hare', status: ['tense'] },
    target_groups: {
      inventory: [{ id: 'item:2', label: 'Lantern', kind: 'item' }],
    },
    actions: [
      { command_type: 'say', tool_name: 'say', title: 'Say', cost: { action: 1 } },
      { command_type: 'wait', tool_name: 'wait', title: 'Wait', available: false },
    ],
  });

  assert.equal(projection.characterId, 'character:1');
  assert.equal(projection.characterName, 'character:1');
  assert.equal(projection.sheet.species, 'hare');
  assert.equal(BunnylandPlay.actionIcon(projection.actions[0]), '💬');
  assert.equal(BunnylandPlay.actionIcon({ command_type: 'scan-network' }), '📡');
  assert.equal(BunnylandPlay.actionIcon({ command_type: 'unknown-action' }), '•');
  assert.equal(BunnylandPlay.filterActions(projection.actions, 'say')[0].command_type, 'say');
  assert.equal(BunnylandPlay.allTargets(projection).some(target => target.label === 'Lantern'), true);
  assert.deepEqual(
    plain(BunnylandPlay.playerControl(
      { characterId: 'character:1', controllerId: 'web:1', generation: 4 },
      projection,
      'character:1',
    )),
    { controllerId: 'web:1', generation: 4 },
  );
  assert.deepEqual(
    plain(BunnylandPlay.playerControl(
      { characterId: 'character:1', controllerId: 'web:1', generation: 3 },
      projection,
      'character:1',
    )),
    { controllerId: 'web:1', generation: 4 },
  );
  assert.equal(
    BunnylandPlay.playerControl(
      { characterId: 'character:1', controllerId: 'web:2', generation: 3 },
      projection,
      'character:1',
    ),
    null,
  );
  assert.equal(
    BunnylandPlay.resolveTargetName('brass', BunnylandPlay.allTargets(projection)).value,
    'item:1',
  );

  const drained = BunnylandPlay.drainNarratedEvents([
    {
      data: {
        event_type: 'CommandRejectedEvent',
        event: {
          event_id: 'event:1',
          visibility: 'directed',
          actor_id: 'character:1',
          reason: 'too tired',
        },
      },
    },
  ], {
    playerId: 'character:1',
    nameFor: id => (id === 'character:1' ? 'Bun' : id),
  });

  assert.equal(drained.lines.length, 1);
  assert.match(drained.lines[0].text, /too tired/);
  assert.equal(drained.lines[0].kind, 'rejection');
  assert.equal(drained.lines[0].icon, '⚠️');

  const system = BunnylandPlay.renderEventLine({
    event_type: 'ControllerChangedEvent',
    event: { event_id: 'event:2', actor_id: 'character:1' },
  }, {
    playerId: 'character:1',
    nameFor: id => (id === 'character:1' ? 'Bun' : id),
  });
  assert.equal(system.kind, 'system');
  assert.equal(system.icon, '🎮');

  const looked = BunnylandPlay.renderEventLine({
    event_type: 'RoomLookedEvent',
    event: { event_id: 'event:3', summary: 'A bright parlor.' },
  }, {
    playerId: 'character:1',
    nameFor: id => (id === 'character:1' ? 'Bun' : id),
  });
  assert.deepEqual(plain(looked), { text: 'A bright parlor.', kind: 'event', icon: '👁️' });
});

test('BunnylandPlay builds character-sheet links and portrait state messages', () => {
  const { BunnylandPlay } = loadBrowserAssets([
    'assets/bunnyland-api.js',
    'assets/bunnyland-play.js',
  ]);

  assert.equal(
    BunnylandPlay.characterSheetHref('http://server.test/api/', 'character:1'),
    'character-sheet.html?server=http%3A%2F%2Fserver.test%2Fapi#character:1',
  );
  assert.equal(BunnylandPlay.portraitStatusMessage({ portrait: { url: '/media/p.png' } }), 'Portrait ready.');
  assert.equal(BunnylandPlay.portraitStatusMessage({ portrait: {} }), 'Portrait pending.');
  assert.equal(
    BunnylandPlay.portraitStatusMessage({ portrait: {} }, 'requesting'),
    'Requesting portrait...',
  );
  assert.equal(
    BunnylandPlay.portraitStatusMessage({ portrait: {} }, 'queued'),
    'Portrait generation queued.',
  );
  assert.equal(
    BunnylandPlay.portraitStatusMessage({ portrait: {} }, 'failed'),
    'Portrait generation unavailable.',
  );
});

test('BunnylandPlay keeps browser client ids in localStorage', () => {
  const context = loadBrowserAssets([
    'assets/bunnyland-api.js',
    'assets/bunnyland-play.js',
  ]);
  const { BunnylandPlay } = context;

  const first = BunnylandPlay.persistentClientId('bunnyland.test.clientId', 'test');
  const second = BunnylandPlay.persistentClientId('bunnyland.test.clientId', 'test');

  assert.equal(second, first);
  assert.equal(context.localStorage.getItem('bunnyland.test.clientId'), first);
  assert.equal(BunnylandPlay.iconPreference('bunnyland.test.icons'), true);
  BunnylandPlay.setIconPreference('bunnyland.test.icons', false);
  assert.equal(BunnylandPlay.iconPreference('bunnyland.test.icons'), false);
});

test('BunnylandPlay parses queue timing and cancels commands with controller identity', async () => {
  const context = loadBrowserAssets([
    'assets/bunnyland-api.js',
    'assets/bunnyland-play.js',
  ]);
  const { BunnylandPlay } = context;

  const queue = BunnylandPlay.parseQueuedCommands({
    character_id: 'character:1',
    world_epoch: 12,
    generated_at_unix: 100,
    next_tick_at_unix: Date.now() / 1000 + 12.4,
    tick_seconds: 5,
    commands: [{ command_id: 'queued:1', command_type: 'say' }],
  });
  assert.equal(queue.characterId, 'character:1');
  assert.equal(queue.generatedAtUnix, 100);
  assert.equal(queue.tickSeconds, 5);
  assert.equal(queue.commands.length, 1);
  assert.ok(BunnylandPlay.queuedCountdownSeconds(queue) >= 11);
  assert.ok(BunnylandPlay.queuedCountdownSeconds(queue) <= 13);

  let request = null;
  context.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ cancelled: true }) };
  };
  const result = await BunnylandPlay.cancelQueuedCommand('/api/', 'character:1', 'queued:1', {
    controllerId: 'web:tui',
    generation: 7,
  });
  assert.deepEqual(result, { cancelled: true });
  assert.equal(request.options.method, 'DELETE');
  assert.equal(
    request.url,
    '/api/world/character/character%3A1/commands/queued%3A1?controller_id=web%3Atui&controller_generation=7',
  );
});

test('BunnylandTrace parses JSONL spans and formats durations', () => {
  const { BunnylandTrace } = loadBrowserAssets(['assets/bunnyland-trace.js']);

  const parsed = BunnylandTrace.parseTraceText([
    JSON.stringify({
      trace_id: 'abc',
      span_id: '1',
      name: 'root',
      start_time_unix_nano: 1000,
      end_time_unix_nano: 5000,
      attributes: { route: '/world' },
      resource: { 'service.name': 'server' },
    }),
  ].join('\n'), 'trace.jsonl');

  assert.equal(parsed.spans.length, 1);
  assert.equal(parsed.traces.length, 1);
  assert.equal(BunnylandTrace.filterSpans(parsed.traces[0], { text: 'world' }).length, 1);
  assert.equal(BunnylandTrace.formatDuration(4000), '4us');
});

test('BunnylandApi builds media URLs and image-request requests', async () => {
  const context = loadBrowserAssets(['assets/bunnyland-api.js']);
  const { BunnylandApi } = context;

  assert.equal(BunnylandApi.mediaUrl('http://s.test/', '/media/portraits/a.png'), 'http://s.test/media/portraits/a.png');
  assert.equal(BunnylandApi.mediaUrl('http://s.test', 'https://cdn.test/x.png'), 'https://cdn.test/x.png');
  assert.equal(BunnylandApi.mediaUrl('http://s.test', ''), '');

  const calls = [];
  context.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ status: 'queued', url: '/media/events/x.png' }) };
  };

  const scene = await BunnylandApi.requestSceneImage('http://s.test/', 'character:1');
  assert.equal(scene.status, 'queued');
  assert.equal(calls[0].url, 'http://s.test/world/character/character%3A1/scene-image');
  assert.equal(calls[0].options.method, 'POST');

  await BunnylandApi.requestEventImage('http://s.test', 'rec:9', 'dramatic');
  assert.equal(calls[1].url, 'http://s.test/world/event/rec%3A9/image');
  assert.deepEqual(JSON.parse(calls[1].options.body), { extra: 'dramatic' });

  const file = { type: 'image/png' };
  await BunnylandApi.uploadCharacterImage('http://s.test/', 'character:1', 'sprite', file, {
    getAuth: () => 'Token secret',
  });
  assert.equal(calls[2].url, 'http://s.test/admin/world/character/character%3A1/image/sprite');
  assert.equal(calls[2].options.method, 'POST');
  assert.equal(calls[2].options.headers['Content-Type'], 'image/png');
  assert.equal(calls[2].options.headers['X-Bunnyland-Admin-Secret'], 'secret');
  assert.equal(calls[2].options.body, file);
});

test('BunnylandPlay exposes portraits and image-request messages', () => {
  const { BunnylandPlay } = loadBrowserAssets([
    'assets/bunnyland-api.js',
    'assets/bunnyland-play.js',
  ]);

  const projection = BunnylandPlay.parseCharacterProjection({
    character_id: 'character:1',
    portrait: { url: '/media/portraits/p.png', alpha_url: '/media/alpha/p.png' },
    room: { id: 'room:1', entities: [{ id: 'character:2', name: 'Marlow', is_character: true, portrait: { url: '/media/portraits/m.png' } }] },
  });
  assert.equal(projection.portrait.url, '/media/portraits/p.png');

  const room = BunnylandPlay.parseRoomProjection({
    room: { id: 'room:1', title: 'Parlor', entities: [{ id: 'character:2', name: 'Marlow', is_character: true, portrait: { url: '/media/portraits/m.png' } }] },
  });
  assert.equal(room.entities[0].portrait.url, '/media/portraits/m.png');

  assert.equal(BunnylandPlay.imageRequestMessage({ ok: true, status: 'queued' }), '👀 image requested');
  assert.equal(BunnylandPlay.imageRequestMessage({ ok: true, status: 'skipped' }), '📸 image ready');
  assert.equal(BunnylandPlay.imageRequestMessage({ ok: false, reason: 'no room' }), '📷 no room');
  assert.equal(BunnylandPlay.imageRequestMessage(null), '📷 image request failed');
});

test('BunnylandPlay extracts and ranks image-completion events', () => {
  const { BunnylandPlay } = loadBrowserAssets([
    'assets/bunnyland-api.js',
    'assets/bunnyland-play.js',
  ]);

  const completed = {
    data: {
      event_type: 'ImageGenerationCompletedEvent',
      event: {
        event_id: 'e1', world_epoch: 5, entity_id: 'history:1', purpose: 'event',
        url: '/media/events/a.png', alpha_url: '/media/alpha/a.png',
      },
    },
  };
  const img = BunnylandPlay.imageCompletionFromMessage(completed, 'http://s.test');
  assert.equal(img.purpose, 'event');
  assert.equal(img.url, 'http://s.test/media/events/a.png');
  assert.equal(img.alphaUrl, 'http://s.test/media/alpha/a.png');
  assert.equal(img.epoch, 5);

  // Non-completion and url-less messages are ignored.
  assert.equal(BunnylandPlay.imageCompletionFromMessage({ data: { event_type: 'SpeechSaidEvent' } }), null);
  assert.equal(BunnylandPlay.imageCompletionFromMessage(
    { data: { event_type: 'ImageGenerationCompletedEvent', event: { url: '' } } }), null);

  const messages = [
    completed,
    { data: { event_type: 'ImageGenerationCompletedEvent',
              event: { event_id: 'e2', world_epoch: 9, purpose: 'portrait', url: '/media/portraits/p.png' } } },
    { data: { event_type: 'ImageGenerationCompletedEvent',
              event: { event_id: 'e3', world_epoch: 12, purpose: 'event', url: '/media/events/b.png' } } },
  ];
  // Newest event-purpose image wins; portrait is filtered out.
  const latest = BunnylandPlay.latestImageCompletion(messages, { base: 'http://s.test', purpose: 'event' });
  assert.equal(latest.url, 'http://s.test/media/events/b.png');
  assert.equal(latest.epoch, 12);
  // Without a purpose filter, the newest overall wins.
  assert.equal(BunnylandPlay.latestImageCompletion(messages).epoch, 12);
  assert.equal(BunnylandPlay.latestImageCompletion([]), null);
});

test('BunnylandPlay builds inventory entries for the carried-items pane', () => {
  const { BunnylandPlay } = loadBrowserAssets([
    'assets/bunnyland-api.js',
    'assets/bunnyland-play.js',
  ]);

  const projection = {
    inventory: [
      { id: 'item:1', label: 'Brass Key', kind: 'item' },
      { id: 'item:2', kind: 'food' },
    ],
  };
  const entries = BunnylandPlay.inventoryEntries(projection);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, 'item:1');
  assert.equal(entries[0].label, 'Brass Key');
  assert.equal(entries[0].kind, 'item');
  assert.equal(entries[0].icon, '✦');
  // A missing label falls back to the id; the icon comes from the kind.
  assert.equal(entries[1].label, 'item:2');
  assert.equal(entries[1].icon, '🍎');
  // No inventory (or no projection) yields no rows.
  assert.equal(BunnylandPlay.inventoryEntries({}).length, 0);
  assert.equal(BunnylandPlay.inventoryEntries(null).length, 0);
});

test('BunnylandPlay extracts and ranks image-failure events', () => {
  const { BunnylandPlay } = loadBrowserAssets([
    'assets/bunnyland-api.js',
    'assets/bunnyland-play.js',
  ]);

  const failed = {
    data: {
      event_type: 'ImageGenerationFailedEvent',
      event: {
        event_id: 'f1', world_epoch: 4, entity_id: 'history:1', purpose: 'event',
        reason: 'comfyui exploded',
      },
    },
  };
  const failure = BunnylandPlay.imageFailureFromMessage(failed);
  assert.equal(failure.purpose, 'event');
  assert.equal(failure.reason, 'comfyui exploded');
  assert.equal(failure.epoch, 4);

  // Completions and other events are ignored; a missing reason gets a default.
  assert.equal(BunnylandPlay.imageFailureFromMessage(
    { data: { event_type: 'ImageGenerationCompletedEvent' } }), null);
  assert.equal(BunnylandPlay.imageFailureFromMessage(
    { data: { event_type: 'ImageGenerationFailedEvent', event: {} } }).reason,
    'image generation failed');

  const messages = [
    failed,
    { data: { event_type: 'ImageGenerationFailedEvent',
              event: { event_id: 'f2', world_epoch: 8, purpose: 'portrait', reason: 'no model' } } },
    { data: { event_type: 'ImageGenerationFailedEvent',
              event: { event_id: 'f3', world_epoch: 11, purpose: 'event', reason: 'timeout' } } },
  ];
  // Newest event-purpose failure wins; portrait is filtered out.
  assert.equal(BunnylandPlay.latestImageFailure(messages, { purpose: 'event' }).reason, 'timeout');
  // Without a purpose filter, the newest overall wins.
  assert.equal(BunnylandPlay.latestImageFailure(messages).epoch, 11);
  assert.equal(BunnylandPlay.latestImageFailure([]), null);
});

test('BunnylandPlay image affordance mirrors the server iconography', () => {
  const { BunnylandPlay } = loadBrowserAssets([
    'assets/bunnyland-api.js',
    'assets/bunnyland-play.js',
  ]);

  // Must stay in lockstep with src/bunnyland/imagegen/affordance.py.
  assert.equal(BunnylandPlay.IMAGE_AFFORDANCE.REQUEST_EMOJI, '📷');
  assert.equal(BunnylandPlay.IMAGE_AFFORDANCE.ACK_EMOJI, '👀');
  assert.equal(BunnylandPlay.IMAGE_AFFORDANCE.DELIVER_EMOJI, '📸');
  assert.equal(BunnylandPlay.IMAGE_AFFORDANCE.FAIL_EMOJI, '⚠️');
  assert.equal(BunnylandPlay.IMAGE_AFFORDANCE.REQUEST_LABEL, 'Request image');
  // The shared request-status message uses those constants.
  assert.equal(BunnylandPlay.imageRequestMessage({ ok: true, status: 'skipped' }), '📸 image ready');
  assert.equal(BunnylandPlay.imageRequestMessage({ ok: true, status: 'queued' }), '👀 image requested');
  assert.equal(BunnylandPlay.imageRequestMessage({ ok: false, reason: 'off' }), '📷 off');
});
