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
    location: { href: 'http://example.test/index.html', search: '', pathname: '/index.html' },
    localStorage: new MapStorage(),
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
    target_groups: {
      inventory: [{ id: 'item:2', label: 'Lantern', kind: 'item' }],
    },
    actions: [
      { command_type: 'say', tool_name: 'say', title: 'Say', cost: { action: 1 } },
      { command_type: 'wait', tool_name: 'wait', title: 'Wait', available: false },
    ],
  });

  assert.equal(projection.characterId, 'character:1');
  assert.equal(BunnylandPlay.filterActions(projection.actions, 'say')[0].command_type, 'say');
  assert.equal(BunnylandPlay.allTargets(projection).some(target => target.label === 'Lantern'), true);
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
