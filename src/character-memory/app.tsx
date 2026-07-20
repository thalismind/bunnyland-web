import {
  AuthGate,
  AuthProvider,
  Button,
  EmptyState,
  Pane,
  StatusText,
  Toolbar,
  ToolbarBrand,
  ToolbarRow,
} from '@bunnyland/ui-web/preact';
import { serverFromUrl } from '@bunnyland/ui-web/api';
import { render } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { MemoryCharacterList, type MemoryCharacter } from './character-list';

export interface MemoryMetadata extends Record<string, unknown> {
  source?: string;
  tags?: unknown;
}

export interface MemoryDocument {
  document: string;
  id: string;
  metadata?: MemoryMetadata;
}

export interface MemoryCharacterResponse {
  character_id: string;
  name: string;
  private_collection?: string;
  shared_collections?: string[];
}

interface SendOptions {
  body?: string;
  method?: string;
  prompt?: boolean;
}

export interface CharacterMemoryServices {
  applyConfig: (options: {
    connect: (server: string) => void;
    isConnected: () => boolean;
  }) => Promise<unknown>;
  initClientMenu: () => { close?: () => void } | void;
  normalizeBase: (url: string) => string;
  sendAdmin: (base: string, path: string, options?: SendOptions) => Promise<unknown>;
  serverFromUrl: () => string;
  setServerInUrl: (base: string) => void;
}

interface LegacyApi {
  applyConfigToInput: CharacterMemoryServices['applyConfig'];
  normalizeBase: CharacterMemoryServices['normalizeBase'];
  sendAdmin: CharacterMemoryServices['sendAdmin'];
  serverFromUrl: CharacterMemoryServices['serverFromUrl'];
  setServerInUrl: CharacterMemoryServices['setServerInUrl'];
}

interface LegacyUi {
  initClientMenu: CharacterMemoryServices['initClientMenu'];
}

interface LegacyWindow extends Window {
  BunnylandApi: LegacyApi;
  BunnylandUI: LegacyUi;
}

function browserServices(): CharacterMemoryServices {
  const legacy = window as unknown as LegacyWindow;
  return {
    applyConfig: (options) => legacy.BunnylandApi.applyConfigToInput(options),
    initClientMenu: () => legacy.BunnylandUI.initClientMenu(),
    normalizeBase: (url) => legacy.BunnylandApi.normalizeBase(url),
    sendAdmin: (base, path, options) => legacy.BunnylandApi.sendAdmin(base, path, options),
    serverFromUrl: () => legacy.BunnylandApi.serverFromUrl(),
    setServerInUrl: (base) => legacy.BunnylandApi.setServerInUrl(base),
  };
}

const DEFAULT_BROWSER_SERVICES = browserServices();

type MetadataResult =
  | { ok: true; value: MemoryMetadata }
  | { error: string; ok: false };

export function parseMetadata(raw: string): MetadataResult {
  if (!raw.trim()) return { ok: true, value: {} };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return { error: 'Metadata must be a JSON object.', ok: false };
    }
    return { ok: true, value: value as MemoryMetadata };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), ok: false };
  }
}

function tagsFrom(metadata: MemoryMetadata | undefined): string[] {
  if (Array.isArray(metadata?.tags)) return metadata.tags.map(String);
  if (typeof metadata?.tags === 'string') {
    return metadata.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
  }
  return [];
}

interface MemoryTagEditorProps {
  disabled: boolean;
  onChange: (tags: string[]) => void;
  value: string[];
}

export function MemoryTagEditor({ disabled, onChange, value }: MemoryTagEditorProps) {
  const [draft, setDraft] = useState('');
  const add = (): void => {
    const tag = draft.trim();
    if (!tag) return;
    if (!value.includes(tag)) onChange([...value, tag]);
    setDraft('');
  };
  return (
    <div class="tag-editor">
      <div class="tag-list">
        {value.length ? value.map((tag) => (
          <span class="tag-pill" key={tag}>
            <span>{tag}</span>
            <Button
              aria-label={`Remove tag ${tag}`}
              disabled={disabled}
              onClick={(): void => onChange(value.filter((item) => item !== tag))}
            >x</Button>
          </span>
        )) : <span class="tiny">No tags.</span>}
      </div>
      <div class="tag-entry">
        <input
          class="tag-input"
          disabled={disabled}
          onInput={(event): void => setDraft(event.currentTarget.value)}
          onKeyDown={(event): void => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            add();
          }}
          placeholder="add tag..."
          type="text"
          value={draft}
        />
        <Button data-add-tag disabled={disabled} onClick={add}>Add Tag</Button>
      </div>
    </div>
  );
}

interface DocumentListProps {
  collection: string;
  documents: readonly MemoryDocument[];
  onSelect: (id: string) => void;
  selectedId: string;
}

export function DocumentList({ collection, documents, onSelect, selectedId }: DocumentListProps) {
  if (!collection) return <EmptyState>Select a collection.</EmptyState>;
  if (!documents.length) return <EmptyState>No matching documents.</EmptyState>;
  return <>{documents.map((document) => {
    const source = typeof document.metadata?.source === 'string' ? document.metadata.source : 'unknown';
    const tags = tagsFrom(document.metadata).join(', ');
    return (
      <button
        class={`document-row ${selectedId === document.id ? 'active' : ''}`}
        data-document={document.id}
        key={document.id}
        onClick={(): void => onSelect(document.id)}
        type="button"
      >
        <span class="row-title">{document.id}</span>
        <span class="row-subtitle">{source}{tags ? ` · ${tags}` : ''}</span>
        <span class="row-subtitle">{document.document || ''}</span>
      </button>
    );
  })}</>;
}

interface EditorDraft {
  metadata: string;
  originalMetadata: string;
  originalText: string;
  text: string;
}

const EMPTY_DRAFT: EditorDraft = {
  metadata: '', originalMetadata: '', originalText: '', text: '',
};

function draftFor(document: MemoryDocument | null): EditorDraft {
  const text = document?.document || '';
  const metadata = document ? JSON.stringify(document.metadata || {}, null, 2) : '';
  return { metadata, originalMetadata: metadata, originalText: text, text };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface CharacterMemoryPageProps {
  services?: CharacterMemoryServices;
}

export function CharacterMemoryPage({ services = DEFAULT_BROWSER_SERVICES }: CharacterMemoryPageProps) {
  const [apiUrl, setApiUrl] = useState('/api/v1/');
  const [base, setBase] = useState('');
  const [apiStatus, setApiStatus] = useState('offline');
  const [characters, setCharacters] = useState<MemoryCharacterResponse[]>([]);
  const [documents, setDocuments] = useState<MemoryDocument[]>([]);
  const [collection, setCollection] = useState('');
  const [selectedDocument, setSelectedDocument] = useState<MemoryDocument | null>(null);
  const [creatingDocument, setCreatingDocument] = useState(false);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<EditorDraft>(EMPTY_DRAFT);
  const [editorNotice, setEditorNotice] = useState('');
  const baseRef = useRef('');
  const aliveRef = useRef(true);
  const requestGeneration = useRef(0);
  const documentTextRef = useRef<HTMLTextAreaElement>(null);

  const metadata = useMemo(() => parseMetadata(draft.metadata), [draft.metadata]);
  const changed = draft.text !== draft.originalText || draft.metadata !== draft.originalMetadata;
  const hasDocument = selectedDocument !== null;
  const editorStatus = editorNotice || (
    !hasDocument ? 'Select a document.'
      : changed ? (metadata.ok ? 'Unsaved changes.' : 'Fix metadata JSON.')
        : 'Ready.'
  );

  const clearEditor = useCallback((): void => {
    setSelectedDocument(null);
    setCreatingDocument(false);
    setDraft(EMPTY_DRAFT);
    setEditorNotice('');
  }, []);

  const disconnect = useCallback((sync = true): void => {
    requestGeneration.current += 1;
    baseRef.current = '';
    setBase('');
    setCharacters([]);
    setDocuments([]);
    setCollection('');
    clearEditor();
    setApiStatus('offline');
    if (sync) services.setServerInUrl('');
  }, [clearEditor, services]);

  const connect = useCallback(async (url: string): Promise<void> => {
    const normalized = services.normalizeBase(url);
    requestGeneration.current += 1;
    const generation = requestGeneration.current;
    baseRef.current = normalized;
    setApiUrl(normalized || url);
    setBase(normalized);
    setCharacters([]);
    setDocuments([]);
    setCollection('');
    clearEditor();
    if (!normalized) {
      setApiStatus('offline');
      return;
    }
    setApiStatus('connecting');
    try {
      const response = await services.sendAdmin(normalized, '/admin/memory/collections');
      if (!aliveRef.current || requestGeneration.current !== generation) return;
      const next = response as { characters?: MemoryCharacterResponse[] };
      setCharacters(next.characters || []);
      services.setServerInUrl(normalized);
      setApiStatus('live');
    } catch (error) {
      if (!aliveRef.current || requestGeneration.current !== generation) return;
      baseRef.current = '';
      setBase('');
      setApiStatus(`error: ${errorMessage(error)}`);
    }
  }, [clearEditor, services]);

  useEffect(() => {
    aliveRef.current = true;
    const menu = services.initClientMenu();
    const server = services.serverFromUrl();
    if (server) {
      setApiUrl(server);
      void connect(server);
    }
    void services.applyConfig({
      connect: (configured) => { void connect(configured); },
      isConnected: () => Boolean(baseRef.current),
    }).then((config) => {
      if (!aliveRef.current || baseRef.current || !config || typeof config !== 'object') return;
      const serverUrl = 'serverUrl' in config ? config.serverUrl : '';
      if (typeof serverUrl === 'string' && serverUrl) setApiUrl(serverUrl);
    });
    return () => {
      aliveRef.current = false;
      requestGeneration.current += 1;
      menu?.close?.();
    };
  }, [connect, services]);

  const refresh = async (): Promise<void> => {
    if (!base) return;
    const generation = ++requestGeneration.current;
    try {
      const response = await services.sendAdmin(base, '/admin/memory/collections');
      if (!aliveRef.current || requestGeneration.current !== generation) return;
      setCharacters((response as { characters?: MemoryCharacterResponse[] }).characters || []);
      if (!collection) return;
      if (changed && !window.confirm('Discard unsaved changes?')) return;
      const collectionResponse = await services.sendAdmin(
        base,
        `/admin/memory/collections/${encodeURIComponent(collection)}/documents`,
      );
      if (!aliveRef.current || requestGeneration.current !== generation) return;
      setDocuments((collectionResponse as { documents?: MemoryDocument[] }).documents || []);
      clearEditor();
    } catch (error) {
      if (aliveRef.current) setApiStatus(`error: ${errorMessage(error)}`);
    }
  };

  const loadCollection = async (name: string): Promise<void> => {
    if (!name || !base) return;
    if (changed && !window.confirm('Discard unsaved changes?')) return;
    const generation = ++requestGeneration.current;
    setCollection(name);
    setDocuments([]);
    clearEditor();
    try {
      const response = await services.sendAdmin(
        base,
        `/admin/memory/collections/${encodeURIComponent(name)}/documents`,
      );
      if (!aliveRef.current || requestGeneration.current !== generation) return;
      setDocuments((response as { documents?: MemoryDocument[] }).documents || []);
    } catch (error) {
      if (aliveRef.current) setEditorNotice(`Error: ${errorMessage(error)}`);
    }
  };

  const selectDocument = (id: string): void => {
    if (changed && !window.confirm('Discard unsaved changes?')) return;
    const document = documents.find((item) => item.id === id) || null;
    setSelectedDocument(document);
    setCreatingDocument(false);
    setDraft(draftFor(document));
    setEditorNotice('');
  };

  const newDocument = (): void => {
    if (!collection || (changed && !window.confirm('Discard unsaved changes?'))) return;
    const activeAtSchedule = document.activeElement;
    const draftDocument = { document: '', id: '', metadata: { source: 'admin', tags: [] } };
    setSelectedDocument(draftDocument);
    setCreatingDocument(true);
    setDraft(draftFor(draftDocument));
    setEditorNotice('');
    requestAnimationFrame(() => {
      if (document.activeElement === activeAtSchedule) documentTextRef.current?.focus();
    });
  };

  const saveDocument = async (): Promise<void> => {
    if (!selectedDocument || !collection || !metadata.ok) return;
    const generation = requestGeneration.current;
    const path = creatingDocument
      ? `/admin/memory/collections/${encodeURIComponent(collection)}/documents`
      : `/admin/memory/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(selectedDocument.id)}`;
    try {
      const response = await services.sendAdmin(base, path, {
        body: JSON.stringify({ document: draft.text, metadata: metadata.value }),
        method: creatingDocument ? 'POST' : 'PATCH',
      });
      if (!aliveRef.current || requestGeneration.current !== generation) return;
      const saved = (response as { document: MemoryDocument }).document;
      setDocuments((current) => creatingDocument
        ? [...current, saved]
        : current.map((item) => item.id === saved.id ? saved : item));
      setSelectedDocument(saved);
      setCreatingDocument(false);
      setDraft(draftFor(saved));
      setEditorNotice('');
    } catch (error) {
      if (aliveRef.current) setEditorNotice(`Error: ${errorMessage(error)}`);
    }
  };

  const deleteDocument = async (): Promise<void> => {
    if (!selectedDocument || !collection || creatingDocument) return;
    const id = selectedDocument.id;
    if (!window.confirm(`Delete memory document ${id}?`)) return;
    const generation = requestGeneration.current;
    try {
      await services.sendAdmin(
        base,
        `/admin/memory/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      if (!aliveRef.current || requestGeneration.current !== generation) return;
      setDocuments((current) => current.filter((item) => item.id !== id));
      clearEditor();
    } catch (error) {
      if (aliveRef.current) setEditorNotice(`Error: ${errorMessage(error)}`);
    }
  };

  const characterItems = useMemo<MemoryCharacter[]>(() => characters.map((character) => ({
    characterId: character.character_id,
    collections: [
      { name: character.private_collection || '', scope: 'Private' },
      ...(character.shared_collections || []).map((name) => ({ name, scope: 'Shared' })),
    ].filter((item) => item.name),
    name: character.name,
  })), [characters]);

  const filteredDocuments = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return documents;
    return documents.filter((document) => [
      document.id,
      document.document,
      document.metadata?.source,
      JSON.stringify(document.metadata?.tags || ''),
    ].join('\n').toLowerCase().includes(needle));
  }, [documents, query]);

  const updateTags = (tags: string[]): void => {
    if (!metadata.ok) return;
    setDraft((current) => ({
      ...current,
      metadata: JSON.stringify({ ...metadata.value, tags }, null, 2),
    }));
  };

  const statusTone = apiStatus === 'live' ? 'ok' : apiStatus.startsWith('error:') ? 'error' : 'muted';
  return <>
    <Toolbar id="toolbar">
      <ToolbarRow>
        <ToolbarBrand icon={<img src="favicon.png" alt="" />}>Bunnyland Character Memory</ToolbarBrand>
        <span class="toolbar-sep">|</span>
        <label for="api-url">Server:</label>
        <input
          id="api-url"
          onInput={(event): void => setApiUrl(event.currentTarget.value)}
          spellcheck={false}
          type="text"
          value={apiUrl}
        />
        <Button id="btn-connect" onClick={(): void => {
          if (base) disconnect();
          else void connect(apiUrl.trim());
        }}>{base ? 'Disconnect' : 'Connect'}</Button>
        <Button disabled={!base} id="btn-refresh" onClick={(): void => { void refresh(); }}>Refresh</Button>
        <StatusText class={statusTone === 'ok' ? 'ok' : statusTone === 'error' ? 'err' : ''} id="api-status" tone={statusTone}>{apiStatus}</StatusText>
        <Button id="btn-client-menu" class="client-menu-button">Menu</Button>
      </ToolbarRow>
    </Toolbar>

    <main id="main" class="app-grid">
      <Pane
        id="characters-pane"
        title="Characters"
        tools={<span class="pane-count" id="character-count">{characters.length}</span>}
      >
        <div class="pane-body" id="character-list">
          <MemoryCharacterList
            activeCollection={collection}
            characters={characterItems}
            emptyMessage={base ? 'No memory-enabled characters.' : 'Connect to load characters.'}
            onCollection={(name): void => { void loadCollection(name); }}
          />
        </div>
      </Pane>

      <Pane
        id="documents-pane"
        title="Documents"
        tools={<span class="pane-count" id="document-count">{filteredDocuments.length}</span>}
      >
        <div class="pane-body">
          <div class="control-stack">
            <input
              id="memory-search"
              onInput={(event): void => setQuery(event.currentTarget.value)}
              placeholder="Search id, source, tags, or text"
              spellcheck={false}
              type="search"
              value={query}
            />
          </div>
          <div id="document-list">
            <DocumentList
              collection={collection}
              documents={filteredDocuments}
              onSelect={selectDocument}
              selectedId={selectedDocument?.id || ''}
            />
          </div>
        </div>
      </Pane>

      <Pane
        id="editor-pane"
        title="Editor"
        tools={<span class="pane-count" id="selected-document-id">
          {creatingDocument ? 'New document' : selectedDocument?.id || 'No document'}
        </span>}
      >
        <div id="document-editor">
          <label for="document-text">Document
            <textarea
              disabled={!hasDocument}
              id="document-text"
              onInput={(event): void => {
                setEditorNotice('');
                setDraft((current) => ({ ...current, text: event.currentTarget.value }));
              }}
              ref={documentTextRef}
              spellcheck
              value={draft.text}
            />
          </label>
          <div class="memory-field">
            <div>Tags</div>
            <div id="memory-tags">
              <MemoryTagEditor
                disabled={!hasDocument || !metadata.ok}
                onChange={updateTags}
                value={metadata.ok ? tagsFrom(metadata.value) : tagsFrom(selectedDocument?.metadata)}
              />
            </div>
          </div>
          <label for="metadata-json">Metadata JSON
            <textarea
              disabled={!hasDocument}
              id="metadata-json"
              onInput={(event): void => {
                setEditorNotice('');
                setDraft((current) => ({ ...current, metadata: event.currentTarget.value }));
              }}
              spellcheck={false}
              value={draft.metadata}
            />
          </label>
          <div id="metadata-error">{metadata.ok ? '' : metadata.error}</div>
          <div id="editor-actions">
            <Button disabled={!collection} id="btn-new-document" onClick={newDocument}>New</Button>
            <Button
              disabled={!hasDocument || !changed || !metadata.ok}
              id="btn-save-document"
              onClick={(): void => { void saveDocument(); }}
            >Save</Button>
            <Button
              disabled={!hasDocument || creatingDocument}
              id="btn-delete-document"
              onClick={(): void => { void deleteDocument(); }}
              variant="danger"
            >Delete</Button>
            <span id="editor-status">{editorStatus}</span>
          </div>
        </div>
      </Pane>
    </main>
  </>;
}

const root = document.getElementById('app');
if (root) render(<AuthProvider base={serverFromUrl() || '/api/v1'}><AuthGate scopes={['world:admin']}><CharacterMemoryPage /></AuthGate></AuthProvider>, root);
