import { describe, expect, it } from 'vitest';

import {
  applyLocalPatch,
  exportWorld,
  filterEntities,
  normalizeFragments,
  parseCatalogue,
  parsePatchResult,
  parseRuntimeState,
  parseWorld,
  validateWorld,
} from '../src/world-editor/models';

describe('world editor models', () => {
  it('parses saved snapshots and preserves their exported world shape', () => {
    const world = parseWorld({
      metadata: { version: '1.0', epoch: 7 },
      bunnyland: { seed: 'round-trip', saved_at_epoch: 7 },
      entities: { room: { prefab: 'room', created_epoch: 2 }, item: { prefab: 'item', created_epoch: 3 } },
      components: {
        WorldClockComponent: { room: { tick_index: 1 } },
        IdentityComponent: { room: { name: 'Quiet Room' }, item: { name: 'Key' } },
      },
      relationships: { Contains: { room: [{ target: 'item', edge: { visible: true } }] } },
    });
    expect(world.entities.room?.relationships.Contains?.[0]?.target).toBe('item');
    expect(world.entities.item?.components.IdentityComponent?.name).toBe('Key');

    const reparsed = parseWorld(exportWorld(world));
    expect(reparsed.entities).toEqual(world.entities);
    expect(reparsed.metadata.epoch).toBe(7);
    expect(reparsed.meta.seed).toBe('round-trip');
  });

  it('normalizes API snapshots and patch entities at the external boundary', () => {
    const world = parseWorld({
      world_epoch: 4,
      metadata: { generator: 'server' },
      entities: [{
        id: 'source',
        components: { IdentityComponent: { name: 'Source' } },
        relationships: { ExitTo: [{ target_id: 'target', edge: { direction: 'north' } }] },
      }, { id: 'target', components: {}, relationships: {} }],
    });
    expect(world.metadata.epoch).toBe(4);
    expect(world.entities.source?.relationships.ExitTo?.[0]).toEqual({ target: 'target', edge: { direction: 'north' } });

    const patch = parsePatchResult({
      world_epoch: 5,
      changed_entities: [{ id: 'source', components: {}, relationships: {} }],
      deleted_entities: ['target'],
    });
    expect(patch.changed_entities[0]?.id).toBe('source');
    expect(patch.deleted_entities).toEqual(['target']);
    expect(parseRuntimeState({ paused: true, running: false, world_epoch: 5 })).toEqual({ paused: true, running: false, world_epoch: 5 });
  });

  it('filters by text, component, type, missing component, and invalid targets', () => {
    const world = parseWorld({
      entities: {
        clock: { components: { WorldClockComponent: {} } },
        room: { components: { RoomComponent: { title: 'Moon Room' }, DescriptionComponent: {} }, relationships: { ExitTo: [{ target: 'missing', edge: {} }] } },
      },
    });
    expect(filterEntities(world, 'moon').map(entity => entity.id)).toEqual(['room']);
    expect(filterEntities(world, 'type:room component:description').map(entity => entity.id)).toEqual(['room']);
    expect(filterEntities(world, 'missing:DescriptionComponent').map(entity => entity.id)).toEqual(['clock']);
    expect(filterEntities(world, 'invalid').map(entity => entity.id)).toEqual(['room']);
  });

  it('applies supported local fragment patches and resolves client aliases', () => {
    const world = parseWorld({
      metadata: { epoch: 3 },
      entities: { clock: { components: { WorldClockComponent: {} } } },
    });
    const created = applyLocalPatch(world, [
      { op: 'add_entity', client_id: '$room', prefab: 'room', components: [{ type: 'RoomComponent', fields: { title: 'New Room' } }] },
      { op: 'add_component', entity_id: '$room', component: { type: 'DescriptionComponent', fields: { short: 'Fresh' } } },
      { op: 'set_edge', source_id: 'clock', target_id: '$room', edge: { type: 'Contains', fields: { visible: true } } },
    ]);
    expect(created).toEqual(['entity_2']);
    expect(world.entities.entity_2?.components.DescriptionComponent?.short).toBe('Fresh');
    expect(world.entities.clock?.relationships.Contains?.[0]?.target).toBe('entity_2');
  });

  it('validates clock cardinality and relationship endpoints', () => {
    const snapshot = exportWorld(parseWorld({
      entities: { source: { relationships: { ExitTo: [{ target: 'gone', edge: {} }] } } },
    }));
    expect(validateWorld(snapshot)).toEqual([
      { message: 'expected exactly one WorldClockComponent, found 0' },
      { entityId: 'source', message: 'ExitTo: source targets missing entity gone' },
    ]);
  });

  it('narrows catalogues and fragments while rejecting malformed external data', () => {
    expect(parseCatalogue({ components: { MeterComponent: { json_schema: { type: 'object' } } }, edges: {} }).components.MeterComponent?.json_schema?.type).toBe('object');
    expect(normalizeFragments({ fragments: [{ id: 'one', operations: [{ op: 'add_entity' }] }] }, 'unit')[0]).toMatchObject({ id: 'one', source: 'unit', schema_version: 1 });
    expect(() => parseWorld({ entities: [{ components: {} }] })).toThrow('id');
    expect(() => parseWorld({ entities: {}, relationships: { ExitTo: { source: {} } } })).toThrow('must be an array');
    expect(() => parseCatalogue({ components: [], edges: {} })).toThrow('components');
    expect(() => parsePatchResult({ changed_entities: {}, deleted_entities: [] })).toThrow('changed_entities');
    expect(() => normalizeFragments({ operations: [{ nope: true }] }, 'unit')).toThrow('operation name');
  });
});
