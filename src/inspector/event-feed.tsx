import { EmptyState } from '@bunnyland/ui-web/preact';
import { render } from 'preact';

export interface InspectorEventItem {
  actorId?: string;
  actorName?: string;
  epoch: string;
  icon: string;
  key: string;
  summary: string;
  type: string;
}

interface EventFeedProps {
  events: readonly InspectorEventItem[];
}

export function EventFeed({ events }: EventFeedProps) {
  if (events.length === 0) {
    return <EmptyState id="event-empty">Connect to a live server to stream world events.</EmptyState>;
  }
  return <>
    {events.map((event) => (
      <div class="ev-row" data-event-key={event.key} key={event.key} title={event.type}>
        <span class="ev-epoch">{event.epoch}</span>
        <span class="ev-icon">{event.icon}</span>
        {event.actorId && <>
          <span class="ev-actor" data-select-entity={event.actorId}>{event.actorName}</span>{' '}
        </>}
        <span class="ev-text">{event.summary}</span>
      </div>
    ))}
  </>;
}

export function renderEventFeed(root: HTMLElement, events: readonly InspectorEventItem[]) {
  render(<EventFeed events={events} />, root);
}

type InspectorBridge = { renderEventFeed?: typeof renderEventFeed };
type InspectorWindow = Window & {
  BunnylandInspectorPreact?: InspectorBridge;
  app?: { _renderEventFeed?: () => void };
};

const bridgeWindow = window as InspectorWindow;
bridgeWindow.BunnylandInspectorPreact ??= {};
bridgeWindow.BunnylandInspectorPreact.renderEventFeed = renderEventFeed;
bridgeWindow.app?._renderEventFeed?.();
