import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import './content-warning.css';

const IGNORED_CONTENT_FLAGS_KEY = 'bunnyland.contentFlags.ignore';
const CONTENT_FLAG_PATTERN = /^[a-z][a-z0-9_]*(?::[a-z][a-z0-9_]*)*$/;

interface PendingWarning {
  base: string;
  flags: string[];
  requestId: number;
  signature: string;
}

interface ContentWarningDialogProps {
  flags: string[];
  onAccept: (remember: boolean) => void;
  onDecline: () => void;
}

export type ContentFlagsFetcher = (base: string) => Promise<unknown>;

function normalizeFlags(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(value => value.length <= 64 && CONTENT_FLAG_PATTERN.test(value)))]
    .sort((left, right) => left.localeCompare(right));
}

export function contentFlagsFromResource(resource: unknown): string[] {
  if (
    !resource
    || typeof resource !== 'object'
    || !('world_id' in resource)
    || typeof resource.world_id !== 'string'
    || !('world_epoch' in resource)
    || !Number.isInteger(resource.world_epoch)
    || !('title' in resource)
    || typeof resource.title !== 'string'
    || !('description' in resource)
    || typeof resource.description !== 'string'
    || !('content_flags' in resource)
    || !Array.isArray(resource.content_flags)
    || resource.content_flags.some(value => (
      typeof value !== 'string'
      || value.trim().length > 64
      || !CONTENT_FLAG_PATTERN.test(value.trim())
    ))
  ) {
    throw new Error('invalid public world resource');
  }
  return normalizeFlags(resource.content_flags);
}

export function ignoredContentFlags(): string[] {
  try { return normalizeFlags(JSON.parse(localStorage.getItem(IGNORED_CONTENT_FLAGS_KEY) || '[]'));
  } catch { return []; }
}

function rememberIgnoredContentFlags(flags: string[]): void {
  try {
    localStorage.setItem(
      IGNORED_CONTENT_FLAGS_KEY,
      JSON.stringify(normalizeFlags([...ignoredContentFlags(), ...flags])),
    );
  } catch {
    // Browser preferences are best-effort; acceptance still applies to this session.
  }
}

export function ContentWarningDialog({ flags, onAccept, onDecline }: ContentWarningDialogProps) {
  const [remember, setRemember] = useState(false);
  return <div class="content-warning-backdrop">
    <dialog
      class="content-warning-dialog"
      open
      aria-labelledby="content-warning-title"
      onCancel={(event) => { event.preventDefault(); onDecline(); }}
    >
      <h2 id="content-warning-title">Content warning</h2>
      <p>This world may contain the following content. You must accept this warning before joining.</p>
      <ul>{flags.map(flag => <li key={flag}>{flag}</li>)}</ul>
      <label class="content-warning-ignore">
        <input type="checkbox" checked={remember} onChange={event => setRemember(event.currentTarget.checked)} />
        <span>Ignore these flags in this browser after I accept.</span>
      </label>
      <div class="dialog-actions">
        <button type="button" onClick={onDecline}>Leave</button>
        <button type="button" class="primary" onClick={() => onAccept(remember)}>Accept and Join</button>
      </div>
    </dialog>
  </div>;
}

export function useContentWarningGate(fetchContentFlags: ContentFlagsFetcher) {
  const [pending, setPending] = useState<PendingWarning | null>(null);
  const accepted = useRef(new Map<string, string>());
  const nextRequestId = useRef(0);
  const resolver = useRef<{ requestId: number; resolve: (accepted: boolean) => void } | null>(null);

  useEffect(() => () => {
    nextRequestId.current += 1;
    resolver.current?.resolve(false);
    resolver.current = null;
  }, []);

  const requireAcceptance = useCallback(async (base: string): Promise<boolean> => {
    const requestId = ++nextRequestId.current;
    resolver.current?.resolve(false);
    resolver.current = null;
    setPending(null);
    let resource: unknown;
    try {
      resource = await fetchContentFlags(base);
    } catch (error) {
      if (requestId !== nextRequestId.current) return false;
      throw error;
    }
    if (requestId !== nextRequestId.current) return false;
    const flags = contentFlagsFromResource(resource);
    const signature = flags.join('\n');
    if (accepted.current.get(base) === signature) return true;
    const ignored = new Set(ignoredContentFlags());
    const visible = flags.filter(flag => !ignored.has(flag));
    if (!visible.length) {
      accepted.current.set(base, signature);
      return true;
    }
    return new Promise<boolean>((resolve) => {
      if (requestId !== nextRequestId.current) {
        resolve(false);
        return;
      }
      resolver.current = { requestId, resolve };
      setPending({ base, flags: visible, requestId, signature });
    });
  }, [fetchContentFlags]);

  const settle = useCallback((requestId: number, allow: boolean, remember: boolean): void => {
    const active = resolver.current;
    if (!pending || !active || active.requestId !== requestId) return;
    if (allow) {
      if (remember) rememberIgnoredContentFlags(pending.flags);
      accepted.current.set(pending.base, pending.signature);
    }
    resolver.current = null;
    setPending(null);
    active.resolve(allow);
  }, [pending]);

  return {
    requireAcceptance,
    warningDialog: pending
      ? <ContentWarningDialog
          key={pending.requestId}
          flags={pending.flags}
          onAccept={remember => settle(pending.requestId, true, remember)}
          onDecline={() => settle(pending.requestId, false, false)}
        />
      : null,
  };
}
