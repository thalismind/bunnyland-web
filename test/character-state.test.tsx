import { afterEach, describe, expect, it } from 'vitest';

import {
  HISTORY_LIMIT,
  formatActionCall,
  loadChatState,
  renderMarkdown,
} from '../src/character/chat-state.ts';
import { legacyCharacterUrl } from '../src/character/redirect.ts';

afterEach(() => localStorage.clear());

describe('character chat state', () => {
  it('bounds persisted history and renders sanitized markdown', () => {
    const messages = Array.from({ length: HISTORY_LIMIT + 6 }, (_, index) => ({
      role: index % 2 ? 'character' : 'user', text: `old ${index}`,
    }));
    localStorage.setItem(
      'bunnyland.characterChat.history.chat-test-client.character:one',
      JSON.stringify({ summary: 'summary', messages }),
    );
    const state = loadChatState('chat-test-client', 'character:one');
    expect(state.messages).toHaveLength(HISTORY_LIMIT);
    expect(state.messages[0]?.text).toBe('old 6');

    const html = renderMarkdown('**bold** `code` [safe](https://example.test) <img src=x> [bad](javascript:alert(1))');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('href="https://example.test/"');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).not.toContain('href="javascript:');

    expect(formatActionCall({
      parameters: { target_id: 'red apple', quiet: true },
      tool: 'take',
    })).toBe('take — target: red apple, quiet: true');
  });
});

describe('legacy character URLs', () => {
  it('preserves query parameters and hashes while selecting the matching tab', () => {
    expect(legacyCharacterUrl(
      'https://play.test/character-chat.html?server=%2Fapi&theme=dark#character%3Aone',
      'chat',
    )).toBe('https://play.test/character.html?server=%2Fapi&theme=dark&view=chat#character%3Aone');
    expect(legacyCharacterUrl(
      'https://play.test/character-sheet.html?server=%2Fapi&view=chat#character%3Aone',
      'sheet',
    )).toBe('https://play.test/character.html?server=%2Fapi#character%3Aone');
  });
});
