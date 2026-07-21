import { Button, StatusText, Toolbar, ToolbarBrand, ToolbarRow } from '@bunnyland/ui-web/preact';

import { ControlledSearch, type Status } from './entity-editor';
import type { EditorWorld, RuntimeState, WorldEntity, WorldFragment } from './models';

interface EditorToolbarProps {
  apiUrl: string;
  fragmentId: string;
  fragments: WorldFragment[];
  live: boolean;
  liveAuthorized: boolean;
  onApiUrl: (value: string) => void;
  onCopy: () => void;
  onDownload: () => void;
  onExportFragment: () => void;
  onFetch: () => void;
  onFragmentFile: (file: File) => void;
  onFragmentId: (value: string) => void;
  onImportFragment: () => void;
  onLoadWorld: (file: File) => void;
  onMetadata: (key: 'epoch' | 'generator' | 'seed', value: number | string) => void;
  onNew: () => void;
  onRefreshLibrary: () => void;
  onSaveLive: () => void;
  onToggleLive: () => void;
  onToggleSnapshot: () => void;
  runtime: RuntimeState;
  selected: WorldEntity | null;
  snapshotVisible: boolean;
  status: Status;
  world: EditorWorld;
}

export function EditorToolbar(props: EditorToolbarProps) {
  const { apiUrl, fragmentId, fragments, live, liveAuthorized, runtime, selected, snapshotVisible, status, world } = props;
  const runtimeText = !live ? 'runtime: offline' : runtime.paused == null ? 'runtime: locked' : runtime.paused ? 'runtime: paused' : runtime.running ? 'runtime: playing' : 'runtime: stopped';
  return <Toolbar id="toolbar">
    <ToolbarRow class="toolbar-heading" id="toolbar-row1"><ToolbarBrand icon={<img src="favicon.png" alt="" />}> Bunnyland World Editor</ToolbarBrand><Button id="btn-client-menu" class="client-menu-button">Menu</Button></ToolbarRow>
    <ToolbarRow id="toolbar-row2">
      <label for="file-input">World:</label><input type="file" id="file-input" accept=".json,application/json" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) props.onLoadWorld(file); }} />
      <Button id="btn-new" onClick={props.onNew}>New World</Button><span class="toolbar-sep">|</span>
      <label for="api-url">Server:</label><input type="text" id="api-url" value={apiUrl} spellcheck={false} onInput={event => props.onApiUrl(event.currentTarget.value)} />
      <Button id="btn-fetch" onClick={props.onFetch}>{!liveAuthorized ? 'Login for Live' : 'Load Snapshot'}</Button>
      <Button id="btn-save-live" onClick={props.onSaveLive}>Save Live</Button>
      <Button id="btn-toggle-live" disabled={!live} title={!live ? 'Load a server snapshot before changing runtime state' : runtime.paused ? 'Resume world ticks' : 'Pause world ticks'} onClick={props.onToggleLive}>{!live || runtime.paused == null ? '⏯' : runtime.paused ? '▶' : '⏸'}</Button>
      <span id="runtime-status">{runtimeText}</span><StatusText id="status" class={status.kind} tone={status.kind === 'err' ? 'error' : status.kind === 'ok' ? 'ok' : 'muted'}>{status.text}</StatusText>
    </ToolbarRow>
    <ToolbarRow id="toolbar-row3">
      <label for="fragment-file">Fragments:</label><input type="file" id="fragment-file" accept=".json,application/json" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) props.onFragmentFile(file); event.currentTarget.value = ''; }} />
      <span id="library-select-wrap"><ControlledSearch disabled={!fragments.length} dropdownId="fragment-dropdown" hiddenId="library-select" options={fragments.map(fragment => ({ value: fragment.id, label: `${fragment.kind} · ${fragment.title}` }))} placeholder="find fragment..." value={fragmentId} onChange={props.onFragmentId} /></span>
      <Button id="btn-refresh-library" onClick={props.onRefreshLibrary}>Refresh Library</Button>
      <Button id="btn-import-fragment" disabled={!fragments.length} onClick={props.onImportFragment}>Import Fragment</Button>
      <Button id="btn-export-fragment" disabled={!selected} onClick={props.onExportFragment}>Export Selected Fragment</Button>
    </ToolbarRow>
    <ToolbarRow id="toolbar-row4">
      <label for="meta-seed">Seed:</label><input type="text" id="meta-seed" value={typeof world.meta.seed === 'string' ? world.meta.seed : ''} spellcheck={false} onInput={event => props.onMetadata('seed', event.currentTarget.value)} />
      <label for="meta-generator">Generator:</label><input type="text" id="meta-generator" value={typeof world.meta.generator === 'string' ? world.meta.generator : ''} spellcheck={false} onInput={event => props.onMetadata('generator', event.currentTarget.value)} />
      <label for="meta-epoch">Epoch:</label><input type="number" id="meta-epoch" min="0" value={world.metadata.epoch} onInput={event => props.onMetadata('epoch', Number(event.currentTarget.value || 0))} />
      <span class="toolbar-sep">|</span><Button id="btn-download" onClick={props.onDownload}>Download JSON</Button><Button id="btn-copy" onClick={props.onCopy}>Copy JSON</Button>
      <Button id="btn-toggle-snapshot" title={snapshotVisible ? 'Hide snapshot JSON pane' : 'Show snapshot JSON pane'} onClick={props.onToggleSnapshot}>{snapshotVisible ? 'Hide Snapshot' : 'Show Snapshot'}</Button>
      <span class="toolbar-sep">|</span><span id="world-info">{Object.keys(world.entities).length} entities · epoch {world.metadata.epoch}</span>
    </ToolbarRow>
  </Toolbar>;
}
