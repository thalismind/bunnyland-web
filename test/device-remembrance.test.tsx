import { afterEach, describe, expect, it } from 'vitest';

import {
  clearChatState,
  clearSessionChatStates,
  loadChatState,
  persistSessionChatStates,
  saveChatState,
} from '../src/character/chat-state.ts';
import {
  clearRememberedNarrative,
  rememberOnThisDevice,
  setRememberOnThisDevice,
} from '../src/device-remembrance.ts';

const HISTORY_KEY = 'bunnyland.characterChat.history.client-a.character:one';

afterEach(() => {
  clearSessionChatStates();
  localStorage.clear();
});

describe('device remembrance', () => {
  it('remembers by default', () => {
    expect(rememberOnThisDevice()).toBe(true);
  });

  it('opting out clears cached narrative but keeps unrelated preferences', () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ summary: '', messages: [] }));
    localStorage.setItem('bunnyland.characterChat.markdown', '1');

    setRememberOnThisDevice(false);

    expect(rememberOnThisDevice()).toBe(false);
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
    expect(localStorage.getItem('bunnyland.characterChat.markdown')).toBe('1');
  });

  it('does not persist transcripts while opted out, and clears on demand', () => {
    const state = { summary: 's', messages: [{ role: 'user' as const, text: 'hi' }] };

    setRememberOnThisDevice(false);
    saveChatState('client-a', 'character:one', state);
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
    expect(loadChatState('client-a', 'character:one')).toEqual(state);

    setRememberOnThisDevice(true);
    persistSessionChatStates();
    expect(localStorage.getItem(HISTORY_KEY)).not.toBeNull();

    clearChatState('client-a', 'character:one');
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
    expect(loadChatState('client-a', 'character:one')).toEqual({
      allowCharacterMedia: false,
      messages: [],
      summary: '',
    });

    clearRememberedNarrative();
  });
});
