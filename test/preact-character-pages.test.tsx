import { fireEvent, render } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import { MemoryCharacterList } from '../src/character-memory/character-list';
import { MetricList } from '../src/character/metrics';
import { EventList, type EventRecord } from '../src/event-stream/event-list';

describe('MemoryCharacterList', () => {
  it('keeps keyed collection controls and loads the selected collection', () => {
    const onCollection = vi.fn();
    const characters = [{
      characterId: 'character:hazel', name: 'Hazel',
      collections: [{ name: 'memory-hazel', scope: 'Private' }],
    }];
    const view = render(<MemoryCharacterList
      activeCollection=""
      characters={characters}
      emptyMessage="Empty"
      onCollection={onCollection}
    />);
    const original = view.container.querySelector('[data-collection="memory-hazel"]');
    view.rerender(<MemoryCharacterList
      activeCollection="memory-hazel"
      characters={characters}
      emptyMessage="Empty"
      onCollection={onCollection}
    />);
    const updated = view.container.querySelector('[data-collection="memory-hazel"]');
    expect(updated).toBe(original);
    expect(updated?.classList.contains('active')).toBe(true);
    fireEvent.click(updated!);
    expect(onCollection).toHaveBeenCalledWith('memory-hazel');
  });
});

describe('MetricList', () => {
  it('updates keyed metrics in place and clamps meter width', () => {
    const health = { label: 'Health', maximum: 10, text: '7 / 10', value: 7 };
    const view = render(<MetricList emptyMessage="No vitals." metrics={[health]} />);
    const original = view.container.querySelector('[data-metric="Health"]');
    view.rerender(<MetricList
      emptyMessage="No vitals."
      metrics={[{ ...health, text: '12 / 10', value: 12 }]}
    />);
    const updated = view.container.querySelector('[data-metric="Health"]');
    expect(updated).toBe(original);
    expect(updated?.textContent).toContain('12 / 10');
    expect((updated?.querySelector('.meter-fill') as HTMLElement).style.width).toBe('100%');
  });
});

describe('EventList', () => {
  it('keeps event records keyed by event id while details update', () => {
    const event: EventRecord = {
      actor: 'Pip', epoch: '12', eventId: 'event:12', icon: '💬',
      involved: [{ id: 'character:pip', name: 'Pip' }],
      json: '{"event":"first"}', open: false, summary: 'said hello',
      type: 'SpeechSaidEvent', visibility: 'room',
    };
    const view = render(<EventList events={[event]} />);
    const original = view.container.querySelector('[data-event-id="event:12"]');
    view.rerender(<EventList events={[{ ...event, json: '{"event":"updated"}', open: true }]} />);
    const updated = view.container.querySelector('[data-event-id="event:12"]');
    expect(updated).toBe(original);
    expect((updated as HTMLDetailsElement).open).toBe(true);
    expect(updated?.querySelector('.json-view')?.textContent).toContain('updated');
  });
});
