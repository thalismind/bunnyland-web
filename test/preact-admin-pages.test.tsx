import { fireEvent, render } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import { NamedList } from '../src/behavior-editor/library-list';
import { EventFeed, type InspectorEventItem } from '../src/inspector/event-feed';
import { BlockList, type ScriptBlockItem } from '../src/script-editor/block-list';
import { GeneratedEntityList, type GeneratedEntityItem } from '../src/world-generator/entity-list';

describe('GeneratedEntityList', () => {
  it('retains entity rows as generated state changes', () => {
    const entity: GeneratedEntityItem = {
      generated: false, icon: 'R', id: 'room:meadow', kind: 'room', name: 'Meadow',
    };
    const view = render(<GeneratedEntityList entities={[entity]} />);
    const original = view.container.querySelector('[data-id="room:meadow"]');
    view.rerender(<GeneratedEntityList entities={[{ ...entity, generated: true }]} />);
    const updated = view.container.querySelector('[data-id="room:meadow"]');
    expect(updated).toBe(original);
    expect(updated?.classList.contains('generated')).toBe(true);
  });
});

describe('NamedList', () => {
  it('retains keyed library entries when the server adds another name', () => {
    const view = render(<NamedList names={['say']} itemClass="behavior-name-row" empty="none" />);
    const original = view.container.querySelector('[data-name="say"]');
    view.rerender(<NamedList names={['say', 'wander']} itemClass="behavior-name-row" empty="none" />);
    expect(view.container.querySelector('[data-name="say"]')).toBe(original);
    expect(view.getByText('wander')).toBeTruthy();
  });
});

describe('BlockList', () => {
  it('retains keyed blocks across selection and reports the selected index', () => {
    const onSelect = vi.fn();
    const blocks: ScriptBlockItem[] = [
      { key: 'block:1', meta: 'tick · once', name: 'greet' },
      { key: 'block:2', meta: 'event · always', name: 'move' },
    ];
    const view = render(<BlockList blocks={blocks} selectedIndex={0} onSelect={onSelect} />);
    const original = view.container.querySelector('[data-index="1"]');
    fireEvent.click(original!);
    expect(onSelect).toHaveBeenCalledWith(1);
    view.rerender(<BlockList blocks={blocks} selectedIndex={1} onSelect={onSelect} />);
    expect(view.container.querySelector('[data-index="1"]')).toBe(original);
    expect(original?.classList.contains('active')).toBe(true);
  });

  it('moves block focus with End and ArrowUp', () => {
    const onSelect = vi.fn();
    const blocks: ScriptBlockItem[] = [
      { key: 'one', meta: 'tick', name: 'one' },
      { key: 'two', meta: 'event', name: 'two' },
    ];
    const view = render(<div role="listbox"><BlockList blocks={blocks} selectedIndex={0} onSelect={onSelect} /></div>);
    const first = view.container.querySelector<HTMLElement>('[data-index="0"]')!;
    const second = view.container.querySelector<HTMLElement>('[data-index="1"]')!;
    first.focus();
    fireEvent.keyDown(first, { key: 'End' });
    expect(document.activeElement).toBe(second);
    expect(onSelect).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(second, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
  });
});

describe('EventFeed', () => {
  it('retains prior event rows and preserves delegated entity selection data', () => {
    const first: InspectorEventItem = {
      actorId: 'bunny:juniper', actorName: 'Juniper', epoch: '4s', icon: '→',
      key: 'event:1', summary: 'moved east', type: 'ActorMovedEvent',
    };
    const second: InspectorEventItem = {
      epoch: '5s', icon: '•', key: 'event:2', summary: 'world ticked', type: 'TickEvent',
    };
    const view = render(<EventFeed events={[first]} />);
    const original = view.container.querySelector('[data-event-key="event:1"]');
    expect(original?.querySelector('[data-select-entity]')?.getAttribute('data-select-entity'))
      .toBe('bunny:juniper');
    view.rerender(<EventFeed events={[first, second]} />);
    expect(view.container.querySelector('[data-event-key="event:1"]')).toBe(original);
    expect(view.getByText('world ticked')).toBeTruthy();
  });
});
