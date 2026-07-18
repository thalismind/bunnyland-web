import { Button } from '@bunnyland/ui-web/preact';
import { render } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { CharacterList, type ChatCharacter } from './character-list';
import { Transcript, type TranscriptItem } from './transcript';
import './page.css';

type JsonObject = Record<string, unknown>;

interface ClaimControl {
  claimId?: string;
}

interface ChatAction extends JsonObject {
  command_id?: string;
  reason?: string;
  status?: string;
  tool?: string;
}

interface StoredMessage {
  action?: ChatAction;
  command_id?: string;
  role: 'action' | 'character' | 'user';
  text: string;
}

interface ChatState {
  messages: StoredMessage[];
  summary: string;
}

interface Character {
  character_id: string;
  kind?: string;
  name?: string;
  suspended?: boolean;
}

interface CharacterProjection extends JsonObject {
  portrait?: { url?: string };
}

interface ChatApi {
  applyConfigToInput: (options: { connect: (server: string) => void }) => Promise<unknown>;
  applyServerParam: (options: { connect: (server: string) => void }) => string;
  claimHeaders: (control: ClaimControl | null) => Record<string, string>;
  mediaUrl: (base: string, path: string) => string;
  normalizeBase: (base: string) => string;
  sendJson: (base: string, path: string, options?: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
  }) => Promise<JsonObject>;
  setServerInUrl: (base: string) => void;
}

interface LiveUpdates {
  close: () => void;
}

interface ChatPlay {
  actionIcon: (action: { command_type: string; tool_name: string }) => string;
  createPlayerLiveUpdates: (options: {
    base: string;
    characterId: string;
    control: ClaimControl | null;
    onState: (state: string) => void;
    refresh: () => Promise<void>;
  }) => LiveUpdates;
  persistentClientId: (key: string, prefix: string) => string;
  storedClaimControl: (key: string, characterId: string) => ClaimControl | null;
}

interface ChatUi {
  initClientMenu: () => unknown;
  initTheme: () => unknown;
}

export interface CharacterChatRuntime {
  api: ChatApi;
  play: ChatPlay;
  ui: ChatUi;
}

const CLIENT_ID_KEY = 'bunnyland.characterChat.clientId';
const HISTORY_PREFIX = 'bunnyland.characterChat.history.';
const MARKDOWN_KEY = 'bunnyland.characterChat.markdown';
export const HISTORY_LIMIT = 24;
const PENDING_POLL_MS = 2000;
const CLAIM_CLIENT_KEYS = [
  'bunnyland.webTui.clientId',
  'bunnyland.webRepl.clientId',
  'bunnyland.toon.clientId',
  'bunnyland.3d',
];

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

function storageKey(clientId: string, characterId: string): string {
  return `${HISTORY_PREFIX}${clientId}.${characterId}`;
}

export function loadChatState(clientId: string, characterId: string): ChatState {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(clientId, characterId)) || '{}') as Partial<ChatState>;
    return {
      summary: String(parsed.summary || ''),
      messages: Array.isArray(parsed.messages) ? parsed.messages.slice(-HISTORY_LIMIT) : [],
    };
  } catch {
    return { summary: '', messages: [] };
  }
}

function saveChatState(clientId: string, characterId: string, state: ChatState): void {
  try {
    localStorage.setItem(storageKey(clientId, characterId), JSON.stringify({
      summary: String(state.summary || ''),
      messages: state.messages.slice(-HISTORY_LIMIT),
    }));
  } catch {
    // Local persistence is optional.
  }
}

function historyForPayload(messages: readonly StoredMessage[]): Array<{ role: string; text: string }> {
  return messages
    .filter(message => (message.role === 'user' || message.role === 'character') && message.text)
    .map(message => ({ role: message.role, text: message.text }))
    .slice(-HISTORY_LIMIT);
}

function actionSummary(action: ChatAction): string {
  const tool = action.tool || 'action';
  if (action.status === 'queued') return `${tool} queued as a game action. Results will appear here when it finishes.`;
  if (action.status === 'executed') return `${tool} finished.`;
  if (action.status === 'rejected') return `${tool} failed${action.reason ? `: ${action.reason}` : '.'}`;
  return `${tool}: ${action.status || 'pending'}`;
}

function initials(value: string): string {
  return value.trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('') || '?';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function focusedEntityFromHash(): string {
  try {
    return decodeURIComponent(location.hash.replace(/^#/, '')).trim();
  } catch {
    return '';
  }
}

function setFocusedEntityInHash(characterId: string): void {
  const url = new URL(location.href);
  url.hash = characterId ? encodeURIComponent(characterId) : '';
  history.replaceState(null, '', url);
}

export function CharacterChatPage({ runtime }: { runtime: CharacterChatRuntime }) {
  const [apiUrl, setApiUrl] = useState('/api/v1/');
  const [base, setBase] = useState('');
  const [clientId, setClientId] = useState('');
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedId, setSelectedId] = useState(focusedEntityFromHash);
  const [characterFilter, setCharacterFilter] = useState('');
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [markdownEnabled, setMarkdownEnabled] = useState(() => localStorage.getItem(MARKDOWN_KEY) !== '0');
  const [projections, setProjections] = useState<Record<string, CharacterProjection>>({});
  const [historyRevision, setHistoryRevision] = useState(0);
  const [status, setStatus] = useState({ text: '○ Offline', ok: false });
  const [statusLine, setStatusLine] = useState('Connect to a server with character chat enabled.');
  const [draft, setDraft] = useState('');
  const mountedRef = useRef(true);
  const baseRef = useRef('');
  const clientIdRef = useRef('');
  const charactersRef = useRef<Character[]>([]);
  const selectedRef = useRef('');
  const liveStateRef = useRef('fallback');
  const pendingPolls = useRef(new Map<string, number>());
  const projectionsRef = useRef<Record<string, CharacterProjection>>({});
  const portraitRequest = useRef(0);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  baseRef.current = base;
  clientIdRef.current = clientId;
  charactersRef.current = characters;
  selectedRef.current = selectedId;

  const bumpHistory = useCallback(() => setHistoryRevision(value => value + 1), []);
  const currentName = useCallback((characterId = selectedRef.current): string => (
    charactersRef.current.find(character => character.character_id === characterId)?.name || 'Character'
  ), []);
  const claimControl = useCallback((characterId: string): ClaimControl | null => {
    for (const key of CLAIM_CLIENT_KEYS) {
      const control = runtime.play.storedClaimControl(key, characterId);
      if (control) return control;
    }
    return null;
  }, [runtime]);
  const claimQuery = useCallback((control: ClaimControl | null, extra: Record<string, string>): string => {
    const params = new URLSearchParams(extra);
    if (control?.claimId) params.set('claim_id', control.claimId);
    return params.size ? `?${params}` : '';
  }, []);
  const clearPendingPolls = useCallback((characterId?: string): void => {
    for (const [key, timer] of pendingPolls.current) {
      if (characterId && !key.startsWith(`${characterId}:`)) continue;
      window.clearTimeout(timer);
      pendingPolls.current.delete(key);
    }
  }, []);
  const updateState = useCallback((characterId: string, update: (state: ChatState) => void): void => {
    const state = loadChatState(clientIdRef.current, characterId);
    update(state);
    state.messages = state.messages.slice(-HISTORY_LIMIT);
    saveChatState(clientIdRef.current, characterId, state);
    bumpHistory();
  }, [bumpHistory]);
  const upsertAction = useCallback((characterId: string, action: ChatAction): void => {
    if (!action.tool) return;
    updateState(characterId, (state) => {
      const commandId = action.command_id || '';
      const next: StoredMessage = { role: 'action', text: actionSummary(action), command_id: commandId, action };
      const index = commandId ? state.messages.findIndex(message => message.role === 'action' && message.command_id === commandId) : -1;
      if (index >= 0) state.messages[index] = next;
      else state.messages.push(next);
    });
  }, [updateState]);

  const loadProjection = useCallback(async (characterId: string, force = false): Promise<void> => {
    const server = baseRef.current;
    if (!server || !characterId) return;
    if (!force && projectionsRef.current[characterId]) return;
    const control = claimControl(characterId);
    if (!control?.claimId) return;
    const request = ++portraitRequest.current;
    try {
      const envelope = await runtime.api.sendJson(
        server,
        `/play/claims/${encodeURIComponent(control.claimId)}/projection`,
        { headers: runtime.api.claimHeaders(control) },
      );
      const result = (envelope.character || {}) as CharacterProjection;
      if (!mountedRef.current) return;
      setProjections(current => {
        const next = { ...current, [characterId]: result || {} };
        projectionsRef.current = next;
        return next;
      });
    } catch (error) {
      if (mountedRef.current && selectedRef.current === characterId && request === portraitRequest.current) {
        setStatusLine(`Portrait unavailable: ${errorMessage(error)}`);
      }
    }
  }, [runtime]);

  const startPendingPoll = useCallback((characterId: string, commandId: string, options: { allowLive?: boolean; immediate?: boolean } = {}): void => {
    const server = baseRef.current;
    const currentClient = clientIdRef.current;
    if (!server || !currentClient || !characterId || !commandId) return;
    if (liveStateRef.current === 'live' && selectedRef.current === characterId && !options.allowLive) return;
    const key = `${characterId}:${commandId}`;
    if (pendingPolls.current.has(key)) return;
    const poll = async (): Promise<void> => {
      try {
        const control = claimControl(characterId);
        const response = await runtime.api.sendJson(
          server,
          `/play/claims/${encodeURIComponent(control?.claimId || '')}/jobs/${encodeURIComponent(commandId)}`,
          { headers: runtime.api.claimHeaders(control) },
        );
        if (!mountedRef.current) return;
        const result = response.result && typeof response.result === 'object' ? response.result as JsonObject : response;
        const action = result.action && typeof result.action === 'object' ? result.action as ChatAction : null;
        if (action?.tool) upsertAction(characterId, action);
        if (response.status === 'succeeded' || response.status === 'failed') {
          pendingPolls.current.delete(key);
          if (result.reply) updateState(characterId, (state) => {
            if (!state.messages.some(message => message.role === 'character' && message.command_id === commandId)) {
              state.messages.push({ role: 'character', text: String(result.reply), command_id: commandId });
            }
          });
          if (selectedRef.current === characterId) setStatusLine(action?.tool ? `${action.tool}: ${action.status}` : 'Action finished.');
          return;
        }
        if (selectedRef.current === characterId) setStatusLine(action?.tool ? `${action.tool}: ${action.status}` : 'Waiting for action result...');
        if (liveStateRef.current !== 'live' || selectedRef.current !== characterId) {
          pendingPolls.current.set(key, window.setTimeout(() => { void poll(); }, PENDING_POLL_MS));
        } else pendingPolls.current.delete(key);
      } catch (error) {
        pendingPolls.current.delete(key);
        if (mountedRef.current && selectedRef.current === characterId) setStatusLine(errorMessage(error));
      }
    };
    pendingPolls.current.set(key, window.setTimeout(() => { void poll(); }, options.immediate ? 0 : PENDING_POLL_MS));
  }, [claimControl, claimQuery, runtime, updateState, upsertAction]);

  const resumePendingPolls = useCallback((): void => {
    for (const character of charactersRef.current) {
      const state = loadChatState(clientIdRef.current, character.character_id);
      for (const message of state.messages) {
        if (message.role === 'action' && message.action?.status === 'queued' && message.command_id) {
          startPendingPoll(character.character_id, message.command_id);
        }
      }
    }
  }, [startPendingPoll]);

  const connect = useCallback(async (candidate: string): Promise<void> => {
    const normalized = runtime.api.normalizeBase(candidate);
    if (!normalized || !mountedRef.current) return;
    clearPendingPolls();
    baseRef.current = normalized;
    setBase(normalized);
    setApiUrl(normalized);
    runtime.api.setServerInUrl(normalized);
    projectionsRef.current = {};
    setProjections({});
    const nextClientId = runtime.play.persistentClientId(CLIENT_ID_KEY, 'character-chat');
    clientIdRef.current = nextClientId;
    setClientId(nextClientId);
    try {
      const chatStatus = await runtime.api.sendJson(normalized, '/public/features');
      if (!chatStatus.character_chat) throw new Error('character chat is disabled');
      const list = await runtime.api.sendJson(normalized, '/play/characters');
      if (!mountedRef.current || baseRef.current !== normalized) return;
      const nextCharacters = Array.isArray(list.characters)
        ? list.characters.map((item: JsonObject) => ({ ...item, character_id: item.id })) as Character[]
        : [];
      charactersRef.current = nextCharacters;
      setAllowedTools([]);
      setCharacters(nextCharacters);
      if (!nextCharacters.some(character => character.character_id === selectedRef.current)) {
        selectedRef.current = '';
        setSelectedId('');
        setFocusedEntityInHash('');
      }
      setStatus({ text: '● Live', ok: true });
      setStatusLine(selectedRef.current ? `Chatting with ${currentName()}.` : 'Pick a character.');
      resumePendingPolls();
    } catch (error) {
      if (mountedRef.current) {
        setStatus({ text: `○ ${errorMessage(error)}`, ok: false });
        setStatusLine(errorMessage(error));
      }
    }
  }, [clearPendingPolls, currentName, resumePendingPolls, runtime]);

  useEffect(() => {
    mountedRef.current = true;
    runtime.ui.initTheme();
    runtime.ui.initClientMenu();
    const connectTo = (server: string): void => { if (mountedRef.current) void connect(server); };
    void runtime.api.applyConfigToInput({ connect: connectTo }).then((config) => {
      if (!mountedRef.current || baseRef.current || !config || typeof config !== 'object') return;
      const serverUrl = (config as { serverUrl?: unknown }).serverUrl;
      if (typeof serverUrl === 'string' && serverUrl) setApiUrl(serverUrl);
    });
    runtime.api.applyServerParam({ connect: connectTo });
    const onHashChange = (): void => {
      const characterId = focusedEntityFromHash();
      selectedRef.current = characterId;
      setSelectedId(characterId);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      mountedRef.current = false;
      clearPendingPolls();
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [clearPendingPolls, connect, runtime]);

  useEffect(() => {
    if (!base || !selectedId) return;
    const characterId = selectedId;
    void loadProjection(characterId);
    const live = runtime.play.createPlayerLiveUpdates({
      base,
      characterId,
      control: claimControl(characterId),
      refresh: async () => {
        await loadProjection(characterId, true);
        const state = loadChatState(clientIdRef.current, characterId);
        for (const message of state.messages) {
          if (message.role !== 'action' || message.action?.status !== 'queued' || !message.command_id) continue;
          const key = `${characterId}:${message.command_id}`;
          const timer = pendingPolls.current.get(key);
          if (timer) window.clearTimeout(timer);
          pendingPolls.current.delete(key);
          startPendingPoll(characterId, message.command_id, { immediate: true, allowLive: true });
        }
      },
      onState: (state) => {
        liveStateRef.current = state;
        if (!mountedRef.current) return;
        if (state === 'live') {
          clearPendingPolls(characterId);
          setStatus({ text: '● Live', ok: true });
        } else if (state !== 'closed') {
          setStatus({ text: '○ Reconnecting · polling', ok: false });
          resumePendingPolls();
        }
      },
    });
    return () => live.close();
  }, [base, claimControl, clearPendingPolls, loadProjection, resumePendingPolls, runtime, selectedId, startPendingPoll]);

  useEffect(() => { resumePendingPolls(); }, [characters, clientId, resumePendingPolls]);

  const selectedCharacter = characters.find(character => character.character_id === selectedId);
  const selectedState = useMemo(
    () => selectedId && clientId ? loadChatState(clientId, selectedId) : { summary: '', messages: [] },
    [clientId, historyRevision, selectedId],
  );
  const hasHistory = useCallback((characterId: string) => (
    clientId ? (() => { const state = loadChatState(clientId, characterId); return Boolean(state.summary || state.messages.length); })() : false
  ), [clientId, historyRevision]);
  const filteredCharacters = useMemo(() => {
    const filter = characterFilter.trim().toLowerCase();
    return filter ? characters.filter(character => [
      character.character_id, character.name || '', character.kind || 'character', character.suspended ? 'suspended' : '',
    ].join(' ').toLowerCase().includes(filter)) : characters;
  }, [characterFilter, characters]);
  const characterItems = useMemo<ChatCharacter[]>(() => filteredCharacters.map(character => ({
    characterId: character.character_id,
    hasHistory: hasHistory(character.character_id),
    kind: character.kind || 'character',
    name: character.name || character.character_id,
    selected: character.character_id === selectedId,
    suspended: Boolean(character.suspended),
  })), [filteredCharacters, hasHistory, selectedId]);
  const transcriptItems = useMemo<TranscriptItem[]>(() => {
    const occurrences = new Map<string, number>();
    return selectedState.messages.map((message) => {
      const action = message.action || {};
      const baseKey = message.command_id ? `${message.role}:${message.command_id}` : `${message.role}:${message.text}:${action.tool || ''}`;
      const occurrence = occurrences.get(baseKey) || 0;
      occurrences.set(baseKey, occurrence + 1);
      const key = `${baseKey}:${occurrence}`;
      if (message.role === 'action') return {
        commandId: message.command_id || '',
        icon: runtime.play.actionIcon({
          command_type: String(action.tool || 'action').trim().toLowerCase().replaceAll('_', '-'),
          tool_name: action.tool || 'action',
        }),
        key,
        kind: 'action',
        status: String(action.status || '').replace(/[^a-z0-9_-]/gi, '').toLowerCase(),
        text: message.text || actionSummary(action),
        tool: action.tool || 'action',
      };
      return {
        html: markdownEnabled ? renderMarkdown(message.text) : escapeHtml(message.text),
        key,
        kind: 'message',
        plain: !markdownEnabled,
        role: message.role === 'user' ? 'user' : 'character',
      };
    });
  }, [markdownEnabled, runtime, selectedState.messages]);

  useLayoutEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [transcriptItems]);

  const selectCharacter = (characterId: string): void => {
    selectedRef.current = characterId;
    setSelectedId(characterId);
    setFocusedEntityInHash(characterId);
    setStatusLine(characterId ? `Chatting with ${characters.find(character => character.character_id === characterId)?.name || 'Character'}.` : 'Pick a character.');
  };

  const submit = async (): Promise<void> => {
    const message = draft.trim();
    const characterId = selectedRef.current;
    const server = baseRef.current;
    if (!message || !server || !characterId) return;
    setDraft('');
    const state = loadChatState(clientIdRef.current, characterId);
    const control = claimControl(characterId);
    if (!control?.claimId) {
      setStatusLine('Claim this character in a player client before chatting.');
      return;
    }
    const payload = {
      kind: 'chat',
      message,
      history_summary: state.summary || '',
      history: historyForPayload(state.messages),
    };
    updateState(characterId, current => { current.messages.push({ role: 'user', text: message }); });
    setStatusLine('Waiting for reply...');
    try {
      const job = await runtime.api.sendJson(server, `/play/claims/${encodeURIComponent(control.claimId)}/jobs`, {
        method: 'POST', headers: runtime.api.claimHeaders(control), body: JSON.stringify(payload),
      });
      const response = job.result && typeof job.result === 'object' ? job.result as JsonObject : job;
      if (!mountedRef.current) return;
      if (response.reply) updateState(characterId, current => { current.messages.push({ role: 'character', text: String(response.reply) }); });
      const action = response.action && typeof response.action === 'object' ? response.action as ChatAction : null;
      if (action?.tool) {
        upsertAction(characterId, action);
        if (action.status === 'queued' && action.command_id) startPendingPoll(characterId, action.command_id);
      }
      setStatusLine(action?.tool ? `${action.tool}: ${action.status}${action.reason ? ` · ${action.reason}` : ''}` : 'Reply received.');
    } catch (error) {
      if (mountedRef.current) {
        setStatusLine(errorMessage(error));
        setStatus({ text: `○ ${errorMessage(error)}`, ok: false });
      }
    }
  };

  const projection = selectedId ? projections[selectedId] : undefined;
  const portraitUrl = projection?.portrait?.url ? runtime.api.mediaUrl(base, projection.portrait.url) : '';
  const emptyMessage = selectedId ? 'No local chat history for this character.' : 'Pick a character to start chatting.';

  return <>
    <div id="toolbar"><div class="toolbar-row">
      <span class="toolbar-brand"><img src="favicon.png" alt="" /> Bunnyland Character Chat</span>
      <span class="toolbar-sep">|</span>
      <label for="api-url">Server:</label>
      <input type="text" id="api-url" value={apiUrl} spellcheck={false} onInput={event => setApiUrl(event.currentTarget.value)} />
      <Button id="btn-connect" onClick={() => { void connect(apiUrl.trim()); }}>Connect Live</Button>
      <span id="api-status" style={{ color: status.ok ? 'var(--bl-ok)' : 'var(--bl-error)' }}>{status.text}</span>
      <Button id="btn-client-menu" class="client-menu-button">Menu</Button>
    </div></div>
    <div id="main" class="app-grid">
      <aside id="character-pane" aria-label="Characters">
        <div id="selected-character" hidden={!selectedId}>
          <div id="chat-portrait-frame" class="portrait-frame">
            {selectedId && (portraitUrl
              ? <img src={portraitUrl} alt={`${selectedCharacter?.name || 'Character'} portrait`} />
              : <div class="portrait-placeholder" data-testid="portrait-placeholder">{initials(selectedCharacter?.name || 'Character')}</div>)}
          </div>
        </div>
        <h2 class="pane-title">Characters</h2>
        <div class="character-controls">
          <input ref={filterRef} id="character-filter" type="text" value={characterFilter} placeholder="Search characters" spellcheck={false} onInput={event => setCharacterFilter(event.currentTarget.value)} />
          <Button id="character-filter-clear" onClick={() => { setCharacterFilter(''); filterRef.current?.focus(); }}>Clear</Button>
        </div>
        <div id="character-list"><CharacterList
          characters={characterItems}
          emptyMessage={characters.length ? 'No matching characters.' : 'No characters found.'}
          onSelect={selectCharacter}
        /></div>
      </aside>
      <section id="chat-pane" aria-label="Character chat">
        <div id="chat-tools">
          <span id="chat-title">{selectedCharacter?.name || 'No character selected'}</span>
          <div id="chat-actions">
            <span id="chat-tool-list" title={allowedTools.length ? `Available tools: ${allowedTools.join(', ')}` : ''}>{allowedTools.length ? `Tools: ${allowedTools.join(', ')}` : ''}</span>
            <label class="chat-toggle" for="markdown-toggle">
              <input type="checkbox" id="markdown-toggle" checked={markdownEnabled} onChange={event => {
                const enabled = event.currentTarget.checked;
                setMarkdownEnabled(enabled);
                localStorage.setItem(MARKDOWN_KEY, enabled ? '1' : '0');
              }} /> Markdown
            </label>
            <Button id="btn-clear-history" disabled={!selectedId || !hasHistory(selectedId)} onClick={() => {
              if (!selectedId) return;
              clearPendingPolls(selectedId);
              localStorage.removeItem(storageKey(clientId, selectedId));
              bumpHistory();
              setStatusLine(`Cleared local chat history for ${currentName(selectedId)}.`);
            }}>Clear History</Button>
          </div>
        </div>
        <div id="transcript" ref={transcriptRef}><Transcript emptyMessage={emptyMessage} items={transcriptItems} /></div>
        <div id="status-line">{statusLine}</div>
        <form id="composer" autocomplete="off" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <textarea
            id="chat-input" spellcheck aria-label="Message" value={draft}
            onInput={event => setDraft(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
          />
          <Button id="btn-send" type="submit">Send</Button>
        </form>
      </section>
    </div>
  </>;
}

interface BrowserWindow extends Window {
  BunnylandApi: ChatApi;
  BunnylandPlay: ChatPlay;
  BunnylandUI: ChatUi;
}

const root = document.getElementById('app');
if (root) {
  const browserWindow = window as unknown as BrowserWindow;
  render(<CharacterChatPage runtime={{ api: browserWindow.BunnylandApi, play: browserWindow.BunnylandPlay, ui: browserWindow.BunnylandUI }} />, root);
}
