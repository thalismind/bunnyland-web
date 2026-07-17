import { fireEvent, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SearchHits, type InspectorSearchHit } from '../src/inspector/search-hits';
import { SpanDetail, type TraceSpanDetail } from '../src/trace-analyzer/span-detail';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SearchHits', () => {
  it('keeps keyed hits and external input focus while reporting mouse selection', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const onPick = vi.fn();
    const juniper: InspectorSearchHit = {
      icon: '🐰', id: 'bunny:juniper', name: 'Juniper', type: 'character',
    };
    const view = render(<SearchHits hits={[juniper]} activeIndex={0} onPick={onPick} />);
    const original = view.container.querySelector('[data-select-entity="bunny:juniper"]');

    view.rerender(<SearchHits
      hits={[juniper, { icon: '⌂', id: 'room:meadow', name: 'Meadow', type: 'room' }]}
      activeIndex={1}
      onPick={onPick}
    />);

    expect(view.container.querySelector('[data-select-entity="bunny:juniper"]')).toBe(original);
    expect(document.activeElement).toBe(input);
    expect(view.container.querySelector('[data-i="1"]')?.classList.contains('active')).toBe(true);
    fireEvent.mouseDown(original!);
    expect(onPick).toHaveBeenCalledWith('bunny:juniper');
  });
});

describe('SpanDetail', () => {
  it('keeps keyed detail rows and delegated copy attributes across updates', () => {
    const detail: TraceSpanDetail = {
      childCount: 1,
      duration: '12ms',
      kind: 'SERVER',
      name: 'world.tick',
      rawJson: '{"spanId":"span-1"}',
      sections: [{
        title: 'Span attributes',
        entries: [{ key: 'loop.tick_index', value: '4' }],
      }],
      service: 'bunnyland-server',
      spanId: 'span-1',
      startDate: '12:00:00',
      startOffset: '+2ms',
      status: 'OK',
      traceId: 'trace-1',
    };
    const view = render(<SpanDetail detail={detail} />);
    const original = view.container.querySelector('[data-entry-key="loop.tick_index"]');
    const delegated = vi.fn();
    view.container.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest('button[data-copy]');
      if (button) delegated(button.getAttribute('data-copy'));
    });

    view.rerender(<SpanDetail detail={{ ...detail, duration: '14ms', status: 'ERROR' }} />);

    expect(view.container.querySelector('[data-entry-key="loop.tick_index"]')).toBe(original);
    expect(view.getByText('14ms')).toBeTruthy();
    expect(view.getByText('ERROR')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Span ID' }));
    expect(delegated).toHaveBeenCalledWith('span-1');
  });
});
