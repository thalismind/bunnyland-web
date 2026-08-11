import { describe, expect, it, vi } from 'vitest';

import {
  generationFeatures,
  latestMediaEventId,
  latestVideoCompletion,
  latestVideoFailure,
  requestSceneImage,
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
    }, '/v1', control, 'event:gate-opens');

    expect(result).toEqual({ status: 'queued' });
    expect(sendJson).toHaveBeenCalledWith('/v1', '/play/claims/claim%3Aone/jobs', {
      body: JSON.stringify({ kind: 'scene_video', event_id: 'event:gate-opens' }),
      headers: { 'X-Claim': 'claim:one' },
      method: 'POST',
    });
    await expect(requestSceneVideo({
      claimHeaders: () => ({}),
      sendJson,
    }, '/v1', null)).rejects.toThrow('A character claim is required');
  });

  it('submits an exact-event scene-image job through the package API boundary', async () => {
    const sendJson = vi.fn(async () => ({ status: 'queued' }));
    const api = {
      claimHeaders: (current: { claimId?: string } | null) => ({
        'X-Claim': current?.claimId ?? '',
      }),
      sendJson,
    };

    await requestSceneImage(api, '/v1', { claimId: 'claim:one' }, 'event:gate-opens');

    expect(sendJson).toHaveBeenCalledWith('/v1', '/play/claims/claim%3Aone/jobs', {
      body: JSON.stringify({ kind: 'scene_image', event_id: 'event:gate-opens' }),
      headers: { 'X-Claim': 'claim:one' },
      method: 'POST',
    });
    await expect(requestSceneImage(api, '/v1', null)).rejects.toThrow(
      'A character claim is required',
    );
  });

  it('selects the newest public or room event for media focus', () => {
    const messages = [
      { data: { event_type: 'SpeechToldEvent', event: {
        event_id: 'directed', visibility: 'directed', world_epoch: 8,
      } } },
      { data: { event_type: 'SpeechSaidEvent', event: {
        event_id: 'room-old', visibility: 'room', world_epoch: 4,
      } } },
      { data: { event_type: 'DoorOpenedEvent', event: {
        event_id: 'public-new', visibility: 'public', world_epoch: 7,
      } } },
      { data: { event_type: 'ImageGenerationCompletedEvent', event: {
        event_id: 'media', visibility: 'room', world_epoch: 9,
      } } },
    ];
    expect(latestMediaEventId(messages)).toBe('public-new');
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
