import { rememberOnThisDevice } from '../device-remembrance';

export type JsonObject = Record<string, unknown>;

export interface ChatAction extends JsonObject {
  command_id?: string;
  parameters?: Record<string, unknown>;
  reason?: string;
  status?: string;
  tool?: string;
  media_job?: ChatMediaJob;
}

export interface ChatMediaJob {
  enhancedPrompt?: string;
  error?: string;
  focus?: string;
  id: string;
  kind: 'chat_image' | 'chat_video';
  status: string;
  url?: string;
}

export interface StoredMessage {
  action?: ChatAction;
  command_id?: string;
  job_id?: string;
  media?: ChatMediaJob;
  role: 'action' | 'character' | 'media' | 'user';
  text: string;
}

export interface ChatState {
  allowCharacterMedia: boolean;
  messages: StoredMessage[];
  summary: string;
}

const HISTORY_PREFIX = 'bunnyland.characterChat.history.';
export const HISTORY_LIMIT = 24;
const sessionChatStates = new Map<string, ChatState>();

function escapeHtml(value: unknown): string {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character);
}

function safeMarkdownUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, location.href);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function renderInlineMarkdown(value: unknown): string {
  const code: string[] = [];
  let html = escapeHtml(value).replace(/`([^`\n]+)`/g, (_match, text: string) => {
    const token = `\u0000CODE${code.length}\u0000`;
    code.push(`<code>${text}</code>`);
    return token;
  });
  html = html.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
    const href = safeMarkdownUrl(url);
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
  });
  html = html
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\b_([^_\n]+)_\b/g, '<em>$1</em>');
  return code.reduce((next, item, index) => next.replace(`\u0000CODE${index}\u0000`, item), html);
}

function isListLine(line: string): boolean {
  return /^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line);
}

function isBlockStart(line: string): boolean {
  return /^```/.test(line) || /^(?:#{1,3}\s+|>\s?)/.test(line) || isListLine(line);
}

export function renderMarkdown(value: unknown): string {
  const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index] || '';
    if (!line.trim()) { index += 1; continue; }
    if (/^```/.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index] || '')) {
        code.push(lines[index] || '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = (heading[1]?.length || 1) + 2;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2]?.trim())}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] || '')) {
        quote.push((lines[index] || '').replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(`<blockquote>${renderInlineMarkdown(quote.join('\n'))}</blockquote>`);
      continue;
    }
    if (isListLine(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const tag = ordered ? 'ol' : 'ul';
      const items: string[] = [];
      while (index < lines.length && isListLine(lines[index] || '') && /^\s*\d+\.\s+/.test(lines[index] || '') === ordered) {
        items.push(`<li>${renderInlineMarkdown((lines[index] || '').replace(/^\s*(?:[-*+]\s+|\d+\.\s+)/, ''))}</li>`);
        index += 1;
      }
      blocks.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index]?.trim() && !isBlockStart(lines[index] || '')) {
      paragraph.push((lines[index] || '').trim());
      index += 1;
    }
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
  }
  return blocks.join('');
}

export function splitReplyParagraphs(value: unknown): string[] {
  const normalized = String(value || '').replace(/\r\n?/g, '\n');
  const paragraphs = normalized
    .split(/\n[ \t]*\n+/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
  return paragraphs.length ? paragraphs : [normalized.trim()];
}

export function chatStorageKey(clientId: string, characterId: string): string {
  return `${HISTORY_PREFIX}${clientId}.${characterId}`;
}

export function loadChatState(clientId: string, characterId: string): ChatState {
  const key = chatStorageKey(clientId, characterId);
  if (!rememberOnThisDevice()) {
    const session = sessionChatStates.get(key);
    return session
      ? {
        allowCharacterMedia: session.allowCharacterMedia,
        summary: session.summary,
        messages: [...session.messages],
      }
      : { allowCharacterMedia: false, summary: '', messages: [] };
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}') as Partial<ChatState>;
    const state = {
      allowCharacterMedia: parsed.allowCharacterMedia === true,
      summary: String(parsed.summary || ''),
      messages: Array.isArray(parsed.messages) ? parsed.messages.slice(-HISTORY_LIMIT) : [],
    };
    sessionChatStates.set(key, state);
    return {
      allowCharacterMedia: state.allowCharacterMedia,
      summary: state.summary,
      messages: [...state.messages],
    };
  } catch {
    return { allowCharacterMedia: false, summary: '', messages: [] };
  }
}

export function saveChatState(clientId: string, characterId: string, state: ChatState): void {
  const key = chatStorageKey(clientId, characterId);
  const bounded = {
    allowCharacterMedia: state.allowCharacterMedia,
    summary: String(state.summary || ''),
    messages: state.messages.slice(-HISTORY_LIMIT),
  };
  sessionChatStates.set(key, bounded);
  if (!rememberOnThisDevice()) {
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(bounded));
  } catch {
    // Local persistence is optional.
  }
}

export function clearChatState(clientId: string, characterId: string): void {
  const key = chatStorageKey(clientId, characterId);
  sessionChatStates.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // Local persistence is optional.
  }
}

export function clearSessionChatStates(): void {
  sessionChatStates.clear();
}

export function persistSessionChatStates(): void {
  if (!rememberOnThisDevice()) return;
  try {
    for (const [key, state] of sessionChatStates) {
      localStorage.setItem(key, JSON.stringify(state));
    }
  } catch {
    // Local persistence is optional.
  }
}

export function historyForPayload(messages: readonly StoredMessage[]): Array<{ role: string; text: string }> {
  return messages
    .filter(message => (message.role === 'user' || message.role === 'character') && message.text)
    .map(message => ({ role: message.role, text: message.text }))
    .slice(-HISTORY_LIMIT);
}

export function actionSummary(action: ChatAction): string {
  const tool = action.tool || 'action';
  if (action.media_job) {
    const medium = action.media_job.kind === 'chat_video' ? 'Video' : 'Image';
    return `${medium} illustration requested. Visual directions do not perform actions or change the world.`;
  }
  if (action.status === 'queued') return `${tool} queued as a game action. Results will appear here when it finishes.`;
  if (action.status === 'executed') return `${tool} finished.`;
  if (action.status === 'rejected') return `${tool} failed${action.reason ? `: ${action.reason}` : '.'}`;
  return `${tool}: ${action.status || 'pending'}`;
}

export function formatActionCall(action: ChatAction): string {
  const tool = action.tool || 'action';
  const parameters = action.parameters;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return tool;
  const details = Object.entries(parameters).map(([key, value]) => {
    const label = key.replace(/_id$/, '').replaceAll('_', ' ');
    const encoded = typeof value === 'string' ? value : JSON.stringify(value);
    return `${label}: ${encoded === undefined ? String(value) : encoded}`;
  });
  return details.length ? `${tool} — ${details.join(', ')}` : tool;
}

export function plainMessageHtml(value: unknown): string {
  return escapeHtml(value);
}
