export type GenerationFeatures = {
  imageGeneration: boolean;
  videoGeneration: boolean;
};

export type VideoCompletion = {
  entityId: string;
  epoch: number;
  url: string;
};

export type VideoFailure = {
  entityId: string;
  epoch: number;
  reason: string;
};

export const VIDEO_AFFORDANCE = {
  ACK_EMOJI: '👀',
  DELIVER_EMOJI: '🎞️',
  FAIL_EMOJI: '⚠️',
  REQUEST_EMOJI: '🎬',
} as const;

type ControlClaim = {
  claimId?: string;
};

type VideoRequestApi<Control extends ControlClaim> = {
  claimHeaders(control: Control | null): Record<string, string>;
  sendJson(base: string, path: string, init?: RequestInit): Promise<unknown>;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null;
}

function messageEvent(message: unknown): Record<string, unknown> | null {
  const root = record(message);
  const data = record(root?.data) ?? root;
  return record(data?.event);
}

function messageType(message: unknown): string {
  const root = record(message);
  const data = record(root?.data) ?? root;
  return String(data?.event_type ?? '');
}

export function generationFeatures(value: unknown): GenerationFeatures {
  const data = record(value);
  return {
    imageGeneration: data?.image_generation === true,
    videoGeneration: data?.video_generation === true,
  };
}

export async function fetchGenerationFeatures(
  sendJson: (base: string, path: string) => Promise<unknown>,
  base: string,
): Promise<GenerationFeatures> {
  return generationFeatures(await sendJson(base, '/public/features'));
}

export async function requestSceneVideo<Control extends ControlClaim>(
  api: VideoRequestApi<Control>,
  base: string,
  control: Control | null,
): Promise<unknown> {
  if (!control?.claimId) throw new Error('A character claim is required');
  return api.sendJson(base, `/play/claims/${encodeURIComponent(control.claimId)}/jobs`, {
    method: 'POST',
    headers: api.claimHeaders(control),
    body: JSON.stringify({ kind: 'scene_video' }),
  });
}

export function videoRequestMessage(result: unknown): string {
  const data = record(result);
  if (!data || data.ok === false) {
    return `${VIDEO_AFFORDANCE.REQUEST_EMOJI} ${String(data?.reason ?? 'video request failed')}`;
  }
  if (data.status === 'skipped') return `${VIDEO_AFFORDANCE.DELIVER_EMOJI} video ready`;
  return `${VIDEO_AFFORDANCE.ACK_EMOJI} video requested`;
}

export function latestVideoCompletion(
  messages: unknown[],
  resolveUrl: (url: string) => string,
): VideoCompletion | null {
  let latest: VideoCompletion | null = null;
  for (const message of messages) {
    if (messageType(message) !== 'VideoGenerationCompletedEvent') continue;
    const event = messageEvent(message);
    if (!event?.url) continue;
    const completion = {
      entityId: String(event.entity_id ?? ''),
      epoch: Number(event.world_epoch ?? 0),
      url: resolveUrl(String(event.url)),
    };
    if (!latest || completion.epoch >= latest.epoch) latest = completion;
  }
  return latest;
}

export function latestVideoFailure(messages: unknown[]): VideoFailure | null {
  let latest: VideoFailure | null = null;
  for (const message of messages) {
    if (messageType(message) !== 'VideoGenerationFailedEvent') continue;
    const event = messageEvent(message);
    if (!event) continue;
    const failure = {
      entityId: String(event.entity_id ?? ''),
      epoch: Number(event.world_epoch ?? 0),
      reason: String(event.reason ?? 'video generation failed'),
    };
    if (!latest || failure.epoch >= latest.epoch) latest = failure;
  }
  return latest;
}
