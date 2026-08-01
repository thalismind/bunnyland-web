export interface EventEntity {
  id: string;
  name: string;
}

export interface EventRecord {
  actor: string;
  epoch: string;
  eventId: string;
  icon: string;
  involved: readonly EventEntity[];
  json: string;
  open: boolean;
  summary: string;
  type: string;
  visibility: string;
}

interface EventListProps {
  events: readonly EventRecord[];
  onToggle?: (eventId: string, open: boolean) => void;
}

export function EventList({ events, onToggle }: EventListProps) {
  if (events.length === 0) return <div class="empty">No matching events.</div>;
  return <>{events.map((event) => (
    <details
      class="event-record"
      data-event-id={event.eventId}
      key={event.eventId}
      open={event.open}
      onToggle={(toggleEvent): void => onToggle?.(event.eventId, toggleEvent.currentTarget.open)}
    >
      <summary>
        <span class="ev-epoch">{event.epoch}</span>
        <span aria-hidden="true" class="ev-icon">{event.icon}</span>
        <span class="ev-type">{event.type}</span>
        <span class="ev-summary"><span class="ev-actor">{event.actor}</span> {event.summary}</span>
        <span class="ev-visibility">{event.visibility}</span>
      </summary>
      {event.open && <div class="event-detail">
        <div class="detail-box">
          <div class="detail-title">Involved</div>
          <div class="entity-chip-list">
            {event.involved.length ? event.involved.map((entity) => (
              <div class="entity-chip" key={entity.id}>
                <strong>{entity.name}</strong>
                <code>{entity.id}</code>
              </div>
            )) : <div class="empty">No entity ids on this event.</div>}
          </div>
        </div>
        <div class="detail-box">
          <div class="detail-title">Full Event JSON</div>
          <pre class="json-view">{event.json}</pre>
        </div>
      </div>}
    </details>
  ))}</>;
}
