export interface SpeechBubble {
  eventId: string;
  speakerId: string;
  text: string;
  occurredAt: number;
  expiresAt: number;
}

const SPEECH_EVENT_TYPES = new Set([
  'SpeechSaidEvent',
  'SpeechToldEvent',
  'ConversationLineEvent',
]);

export function updateSpeechBubbles(
  current: readonly SpeechBubble[],
  messages: readonly unknown[],
  now = Date.now(),
): SpeechBubble[] {
  const bubbles = new Map(
    current
      .filter(bubble => bubble.expiresAt > now)
      .map(bubble => [bubble.speakerId, bubble]),
  );
  for (const message of messages) {
    const raw = message as Record<string, unknown> | null;
    const data = (raw?.data || raw || {}) as Record<string, unknown>;
    const eventType = String(data.event_type || '');
    if (!SPEECH_EVENT_TYPES.has(eventType)) continue;
    const event = (data.event || {}) as Record<string, unknown>;
    const eventId = String(event.event_id || '');
    const speakerId = String(event.speaker_id || event.actor_id || '');
    const textCharacters = [...String(event.text || '').trim()];
    if (!eventId || !speakerId || !textCharacters.length) continue;
    const occurredAt = Date.parse(String(event.created_at || '')) || now;
    const bubble: SpeechBubble = {
      eventId,
      speakerId,
      text: textCharacters.length <= 160 ? textCharacters.join('') : `${textCharacters.slice(0, 159).join('')}…`,
      occurredAt,
      expiresAt: occurredAt + 6_000,
    };
    if (bubble.expiresAt > now) bubbles.set(speakerId, bubble);
  }
  return [...bubbles.values()];
}
