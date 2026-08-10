import { describe, expect, it, vi } from 'vitest';

import {
  generationFeatures,
  latestVideoCompletion,
  latestVideoFailure,
  requestSceneVideo,
  videoRequestMessage,
} from '../src/media-generation.ts';

describe('optional media generation helpers', () => {
  it('normalizes independent image and video feature flags', () => {
    expect(generationFeatures({ image_generation: false, video_generation: true })).toEqual({
      imageGeneration: false,
      videoGeneration: true,
    });
    expect(generationFeatures(null)).toEqual({
      imageGeneration: false,
      videoGeneration: false,
    });
  });

  it('submits a scene-video job through an existing character claim', async () => {
    const sendJson = vi.fn(async () => ({ status: 'queued' }));
    const control = { claimId: 'claim:one' };

    const result = await requestSceneVideo({
      claimHeaders: current => ({ 'X-Claim': current?.claimId ?? '' }),
      sendJson,
    }, '/v1', control);

    expect(result).toEqual({ status: 'queued' });
    expect(sendJson).toHaveBeenCalledWith('/v1', '/play/claims/claim%3Aone/jobs', {
      body: JSON.stringify({ kind: 'scene_video' }),
      headers: { 'X-Claim': 'claim:one' },
      method: 'POST',
    });
    await expect(requestSceneVideo({
      claimHeaders: () => ({}),
      sendJson,
    }, '/v1', null)).rejects.toThrow('A character claim is required');
  });

  it('formats requests and selects the newest completion and failure', () => {
    expect(videoRequestMessage({ status: 'queued' })).toBe('👀 video requested');
    expect(videoRequestMessage({ status: 'skipped' })).toBe('🎞️ video ready');
    expect(videoRequestMessage({ ok: false, reason: 'no room' })).toBe('🎬 no room');

    const messages = [
      { data: { event_type: 'VideoGenerationCompletedEvent', event: {
        entity_id: 'history:one', url: '/media/a.mp4', world_epoch: 2,
      } } },
      { data: { event_type: 'VideoGenerationCompletedEvent', event: {
        entity_id: 'history:two', url: '/media/b.webm', world_epoch: 5,
      } } },
      { data: { event_type: 'VideoGenerationFailedEvent', event: {
        entity_id: 'history:three', reason: 'provider failed', world_epoch: 6,
      } } },
    ];

    expect(latestVideoCompletion(messages, url => `/v1${url}`)).toEqual({
      entityId: 'history:two',
      epoch: 5,
      url: '/v1/media/b.webm',
    });
    expect(latestVideoFailure(messages)).toEqual({
      entityId: 'history:three',
      epoch: 6,
      reason: 'provider failed',
    });
  });
});
