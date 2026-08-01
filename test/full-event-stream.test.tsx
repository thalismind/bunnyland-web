import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventStreamPage, type EventStreamRuntime } from '../src/event-stream/page';
import { expectNoSeriousAxeIssues } from './axe';

function event(eventId: string, eventType: string, text: string) {
  return {
    data: {
      event_type: eventType,
      event: {
        actor_id: 'character:pip',
        event_id: eventId,
        text,
        visibility: 'room',
        world_epoch: 12,
      },
    },
  };
}

function runtime(options: {
  autoConnect?: boolean;
  eventResponses?: unknown[][];
} = {}): EventStreamRuntime {
  let response = 0;
  return {
    api: {
      applyConfigToInput: vi.fn(async () => ({})),
      applyServerParam: vi.fn(({ connect }) => {
        if (options.autoConnect) connect('/mock');
        return options.autoConnect ? '/mock' : '';
      }),
      normalizeBase: value => value.replace(/\/$/, ''),
      sendAdmin: vi.fn(async (_base, path) => {
        if (path.endsWith('/snapshot')) {
          return {
            entities: [{
              id: 'character:pip',
              components: { IdentityComponent: { name: 'Pip' } },
            }],
          };
        }
        const responses = options.eventResponses || [[event('speech', 'SpeechSaidEvent', 'hello')]];
        const events = responses[Math.min(response, responses.length - 1)] || [];
        response += 1;
        return { events };
      }),
      setServerInUrl: vi.fn(),
    },
    events: {
      ROUTINE_EVENT_TYPES: new Set(['EntitySeenEvent']),
      eventSummary: (_type, body) => String(body.text || ''),
      icon: type => type === 'SpeechSaidEvent' ? '"' : 'o',
      involvedIds: () => ['character:pip'],
    },
    ui: { initClientMenu: vi.fn() },
    world: {
      entityDisplayName: () => 'Pip',
      parseApiSnapshot: snapshot => ({
        entities: Object.fromEntries(((snapshot.entities || []) as Array<{ id: string }>).map(entity => [entity.id, entity])),
      }),
    },
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('EventStreamPage', () => {
  it('filters records and keeps expanded state in the Preact root', async () => {
    const view = render(<EventStreamPage runtime={runtime({
      autoConnect: true,
      eventResponses: [[
        event('seen', 'EntitySeenEvent', 'routine'),
        event('speech', 'SpeechSaidEvent', 'hello black fern'),
      ]],
    })} />);

    await waitFor(() => expect(view.getByText('connected · 2 buffered')).toBeTruthy());
    expect(view.container.querySelectorAll('.event-record')).toHaveLength(1);

    fireEvent.click(view.container.querySelector('.event-record summary')!);
    await waitFor(() => expect((view.container.querySelector('[data-event-id="speech"]') as HTMLDetailsElement).open).toBe(true));

    fireEvent.click(view.container.querySelector('#hide-routine')!);
    expect(view.container.querySelectorAll('.event-record')).toHaveLength(2);
    fireEvent.input(view.container.querySelector('#event-search')!, { target: { value: 'black fern' } });
    expect(view.container.querySelectorAll('.event-record')).toHaveLength(1);
    expect((view.container.querySelector('[data-event-id="speech"]') as HTMLDetailsElement).open).toBe(true);
    await expectNoSeriousAxeIssues(view.container);
  });

  it('retains keyed event nodes when a refresh appends another record', async () => {
    const view = render(<EventStreamPage runtime={runtime({
      autoConnect: true,
      eventResponses: [
        [event('speech', 'SpeechSaidEvent', 'first')],
        [
          event('speech', 'SpeechSaidEvent', 'first'),
          event('speech-2', 'SpeechSaidEvent', 'updated'),
        ],
      ],
    })} />);
    await waitFor(() => expect(view.getByText('first')).toBeTruthy());
    const original = view.container.querySelector('[data-event-id="speech"]');

    fireEvent.click(view.container.querySelector('#btn-refresh')!);
    await waitFor(() => expect(view.getByText('updated')).toBeTruthy());
    expect(view.container.querySelector('[data-event-id="speech"]')).toBe(original);
  });

  it('only renders pretty event JSON for expanded records', async () => {
    const view = render(<EventStreamPage runtime={runtime({ autoConnect: true })} />);
    await waitFor(() => expect(view.container.querySelector('.event-record')).toBeTruthy());
    expect(view.container.querySelector('.json-view')).toBeNull();
    fireEvent.click(view.container.querySelector('.event-record summary')!);
    await waitFor(() => expect(view.container.querySelector('.json-view')?.textContent).toContain('"SpeechSaidEvent"'));
  });

  it('cleans up the polling timer when the page unmounts', async () => {
    vi.useFakeTimers();
    const view = render(<EventStreamPage runtime={runtime()} />);
    fireEvent.input(view.container.querySelector('#api-url')!, { target: { value: '/mock' } });
    await act(async () => {
      fireEvent.click(view.container.querySelector('#btn-connect')!);
      await Promise.resolve();
    });
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
