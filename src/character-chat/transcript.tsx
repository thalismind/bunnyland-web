import { render } from 'preact';

export interface TranscriptAction {
  commandId: string;
  icon: string;
  key: string;
  kind: 'action';
  status: string;
  text: string;
  tool: string;
}

export interface TranscriptMessage {
  html: string;
  key: string;
  kind: 'message';
  plain: boolean;
  role: 'character' | 'user';
}

export type TranscriptItem = TranscriptAction | TranscriptMessage;

interface TranscriptProps {
  emptyMessage: string;
  items: readonly TranscriptItem[];
}

export function Transcript({ emptyMessage, items }: TranscriptProps) {
  if (items.length === 0) return <div class="side-empty">{emptyMessage}</div>;
  return <>{items.map((item) => item.kind === 'action'
    ? <div
      class={`action-message ${item.status}`}
      data-command-id={item.commandId}
      data-message-key={item.key}
      key={item.key}
    >
      <span class="action-icon" aria-hidden="true">{item.icon}</span>
      <span><strong>{item.tool}</strong> · {item.text}</span>
    </div>
    : <div
      class={`message ${item.role} ${item.plain ? 'plain' : ''}`}
      data-message-key={item.key}
      dangerouslySetInnerHTML={{ __html: item.html }}
      key={item.key}
    />,
  )}</>;
}

export function renderTranscript(root: HTMLElement, props: TranscriptProps) {
  render(<Transcript {...props} />, root);
}

interface CharacterChatTranscriptWindow {
  BunnylandPreact?: {
    renderTranscript?: typeof renderTranscript;
  };
  renderCharacterChatTranscript?: () => void;
}

const bridgeWindow = window as unknown as CharacterChatTranscriptWindow;
bridgeWindow.BunnylandPreact ??= {};
bridgeWindow.BunnylandPreact.renderTranscript = renderTranscript;
bridgeWindow.renderCharacterChatTranscript?.();
