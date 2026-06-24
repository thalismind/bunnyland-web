(function () {
  'use strict';

  const EVENT_ICONS = {
    ActionPointsChangedEvent: '*',
    ActorMovedEvent: '>',
    AdoptionCompletedEvent: '+',
    AffectChangedEvent: '~',
    AttentionShiftedEvent: '@',
    BleedingChangedEvent: '!',
    BirthDueEvent: '+',
    BirthResolvedEvent: '+',
    CharacterDiedEvent: 'x',
    CharacterDownedEvent: '!',
    CharacterRevivedEvent: '+',
    ColonyWealthUpdatedEvent: '$',
    CommandExecutedEvent: '#',
    CommandQueuedEvent: '+',
    CommandRejectedEvent: '!',
    CommandSubmittedEvent: '+',
    ConversationEndedEvent: '-',
    ConversationLineEvent: '"',
    ConversationStartedEvent: '"',
    ControllerChangedEvent: '@',
    DoorClosedEvent: '-',
    DoorOpenedEvent: '+',
    EncumbranceChangedEvent: '%',
    EntitySeenEvent: 'o',
    FocusPointsChangedEvent: '*',
    InjuryAddedEvent: '!',
    ItemCraftedEvent: '#',
    ItemDroppedEvent: 'v',
    ItemPutEvent: '>',
    ItemTakenEvent: '<',
    MentalStateChangedEvent: '~',
    NoiseHeardEvent: ')',
    NoteTakenEvent: '+',
    NotesSearchedEvent: '?',
    OwnershipClaimedEvent: '#',
    PartnershipEndedEvent: '-',
    PartnershipStartedEvent: '+',
    PainChangedEvent: '!',
    ReflectionCreatedEvent: '~',
    ResourceGatheredEvent: '*',
    SpeechSaidEvent: '"',
    SpeechToldEvent: '"',
    TimeOfDayChangedEvent: 't',
    WeatherChangedEvent: 'w',
    WorldPauseStatusChangedEvent: '|',
  };

  const ROUTINE_EVENT_TYPES = new Set([
    'ActionPointsChangedEvent',
    'AttentionShiftedEvent',
    'ColonyWealthUpdatedEvent',
    'EntitySeenEvent',
    'FocusPointsChangedEvent',
    'TimeOfDayChangedEvent',
    'WeatherChangedEvent',
  ]);

  const NON_ENTITY_ID_KEYS = new Set([
    'causation_id',
    'command_id',
    'conversation_id',
    'correlation_id',
    'event_id',
    'note_id',
    'state',
  ]);

  function icon(type) {
    return EVENT_ICONS[type] || '.';
  }

  function humanizeEvent(type) {
    return String(type || 'Event')
      .replace(/Event$/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase();
  }

  function names(ids, nameFor) {
    return (ids || []).map((id) => nameFor(id)).join(', ');
  }

  function eventSummary(type, event, nameFor = (id) => String(id).slice(0, 14)) {
    const ev = event || {};
    switch (type) {
      case 'ActorMovedEvent':
        return `moved ${ev.direction ? `${ev.direction} ` : ''}-> ${nameFor(ev.to_room_id)}`;
      case 'ActionPointsChangedEvent':
        return `AP -> ${ev.current}/${ev.maximum}`;
      case 'FocusPointsChangedEvent':
        return `focus -> ${ev.current}/${ev.maximum}`;
      case 'NoiseHeardEvent':
        return ev.text ? `heard ${ev.text}` : 'heard a noise';
      case 'EntitySeenEvent':
        return `saw ${names(ev.target_ids, nameFor) || nameFor(ev.entity_id) || 'something'}`;
      case 'MentalStateChangedEvent':
        return `${ev.state || 'mental state changed'}${ev.reason ? `: ${ev.reason}` : ''}`;
      case 'SpeechSaidEvent':
      case 'SpeechToldEvent':
        return ev.text || humanizeEvent(type);
      case 'ConversationStartedEvent':
        return `started conversation${ev.topic ? `: ${ev.topic}` : ''}`;
      case 'ConversationLineEvent':
        return ev.text || 'conversation continued';
      case 'ConversationEndedEvent':
        return `conversation ended${ev.reason ? `: ${ev.reason}` : ''}`;
      case 'CommandSubmittedEvent':
        return `submitted ${ev.command_type || 'command'}`;
      case 'CommandQueuedEvent':
        return `queued ${ev.command_type || 'command'}${ev.lane ? ` on ${ev.lane}` : ''}`;
      case 'CommandExecutedEvent':
        return `executed ${ev.command_type || 'command'}`;
      case 'CommandRejectedEvent':
        return `command rejected${ev.reason ? `: ${ev.reason}` : ''}`;
      case 'CharacterDiedEvent':
        return `died${ev.cause ? `: ${ev.cause}` : ''}`;
      case 'CharacterDownedEvent':
        return `was downed${ev.cause ? `: ${ev.cause}` : ''}`;
      case 'CharacterRevivedEvent':
        return 'revived';
      case 'InjuryAddedEvent':
        return `injured ${ev.body_part || 'body'}${ev.severity != null ? ` (${ev.severity})` : ''}`;
      case 'PartnershipStartedEvent':
        return `partnered with ${names(ev.target_ids, nameFor)}`;
      case 'PartnershipEndedEvent':
        return 'partnership ended';
      case 'ResourceGatheredEvent':
        return `gathered ${ev.quantity || 1} ${ev.resource_type || 'resource'}`;
      case 'ItemCraftedEvent':
        return 'crafted an item';
      case 'ItemTakenEvent':
        return `took ${nameFor(ev.item_id)}`;
      case 'ItemPutEvent':
        return `put ${nameFor(ev.item_id)} into ${nameFor(ev.to_container_id)}`;
      case 'ItemDroppedEvent':
        return `dropped ${nameFor(ev.item_id)}`;
      case 'DoorOpenedEvent':
        return `opened ${nameFor(ev.target_id)}`;
      case 'DoorClosedEvent':
        return `closed ${nameFor(ev.target_id)}`;
      case 'NoteTakenEvent':
        return `took note${ev.collection ? ` in ${ev.collection}` : ''}`;
      case 'NotesSearchedEvent':
        return `searched notes${ev.query ? ` for ${ev.query}` : ''}`;
      case 'ReflectionCreatedEvent':
        return 'created a reflection';
      case 'WorldPauseStatusChangedEvent':
        return ev.message || ev.state || 'pause status changed';
      case 'TimeOfDayChangedEvent':
        return `${ev.phase || 'time'} day ${ev.day}, hour ${ev.hour}`;
      case 'WeatherChangedEvent':
        return `${ev.condition || 'weather'}${ev.intensity != null ? ` (${ev.intensity})` : ''}`;
      default:
        return humanizeEvent(type);
    }
  }

  function collectIds(value, output) {
    if (Array.isArray(value)) {
      for (const item of value) collectIds(item, output);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, raw] of Object.entries(value)) {
      if (NON_ENTITY_ID_KEYS.has(key)) continue;
      if (key.endsWith('_id') && typeof raw === 'string') output.add(raw);
      else if (key.endsWith('_ids') && Array.isArray(raw)) {
        for (const item of raw) {
          if (typeof item === 'string') output.add(item);
        }
      } else if (key === 'payload' || key === 'result_events') {
        collectIds(raw, output);
      }
    }
  }

  function involvedIds(data) {
    const event = data?.event || data || {};
    const ids = new Set();
    collectIds(event, ids);
    return [...ids];
  }

  window.BunnylandEvents = {
    ROUTINE_EVENT_TYPES,
    eventSummary,
    humanizeEvent,
    icon,
    involvedIds,
  };
}());
