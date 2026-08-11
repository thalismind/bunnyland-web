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

export interface TranscriptMedia {
  enhancedPrompt: string;
  error: string;
  focus: string;
  key: string;
  kind: 'media';
  mediaKind: 'chat_image' | 'chat_video';
  status: string;
  url: string;
}

export type TranscriptItem = TranscriptAction | TranscriptMedia | TranscriptMessage;

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
    : item.kind === 'media'
      ? <figure class={`chat-media-card ${item.status}`} data-message-key={item.key} key={item.key}>
        <figcaption>
          <span
            aria-label={`${item.mediaKind === 'chat_video' ? 'Video' : 'Image'} illustration ${item.status === 'succeeded' ? 'ready' : item.status === 'failed' ? 'failed' : 'pending'}`}
            class="chat-media-marker"
            role="status"
          >
            <span aria-hidden="true">{item.mediaKind === 'chat_video' ? '🎬' : '📷'}</span>
            {item.status === 'succeeded' ? 'ready' : item.status === 'failed' ? 'failed' : 'pending'}
          </span>
          <strong>{item.mediaKind === 'chat_video' ? 'Chat video' : 'Chat image'}</strong>
          {item.focus ? ` · ${item.focus}` : ''}
        </figcaption>
        {item.status === 'succeeded' && item.url
          ? item.mediaKind === 'chat_video'
            ? <video
              aria-label={item.enhancedPrompt || item.focus || 'Video illustration of this chat'}
              controls
              preload="metadata"
              src={item.url}
            />
            : <img
              alt={item.enhancedPrompt || item.focus || 'Illustration of this chat'}
              src={item.url}
            />
          : <div class="chat-media-status" role="status">
            {item.status === 'failed'
              ? item.error || 'Media generation failed.'
              : 'Illustration queued…'}
          </div>}
        <small>Illustrative only · no actions were performed and the world was not changed.</small>
      </figure>
      : <div
      class={`message ${item.role} ${item.plain ? 'plain' : ''}`}
      data-message-key={item.key}
      dangerouslySetInnerHTML={{ __html: item.html }}
      key={item.key}
      />,
  )}</>;
}
