import { useEffect, useRef, useState } from 'preact/hooks';

import { renderMarkdown } from './character/chat-state';
import './world-details.css';

const CONTENT_FLAG_PATTERN = /^[a-z][a-z0-9_]*(?::[a-z][a-z0-9_]*)*$/;

interface WorldEntityLike {
  components: Record<string, Record<string, unknown>>;
  id: string;
}

export interface WorldDetails {
  contentFlags: string[];
  description: string;
  title: string;
}

export interface WorldDetailsTarget {
  details: WorldDetails;
  entityId: string;
}

interface WorldDetailsEditorProps {
  disabled?: boolean;
  idPrefix: string;
  onSave: (details: WorldDetails) => Promise<void> | void;
  target: WorldDetailsTarget | null;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function contentFlagsField(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function findWorldDetails(
  entities: Record<string, WorldEntityLike>,
): WorldDetailsTarget | null {
  const entity = Object.values(entities).find(
    item => item.components.WorldInfoComponent,
  ) ?? Object.values(entities).find(item => item.components.WorldClockComponent);
  if (!entity) return null;
  const component = entity.components.WorldInfoComponent ?? {};
  return {
    details: {
      contentFlags: contentFlagsField(component.content_flags),
      description: stringField(component.description),
      title: stringField(component.title),
    },
    entityId: entity.id,
  };
}

function parseContentFlags(value: string): string[] {
  const flags = [...new Set(value.split(/[\n,]+/).map(flag => flag.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const invalid = flags.find(flag => flag.length > 64 || !CONTENT_FLAG_PATTERN.test(flag));
  if (invalid) {
    throw new Error(
      `"${invalid}" must be a lower-case identifier with optional colon namespaces`,
    );
  }
  return flags;
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

export function WorldDetailsEditor({
  disabled = false,
  idPrefix,
  onSave,
  target,
}: WorldDetailsEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(target?.details.title ?? '');
  const [description, setDescription] = useState(target?.details.description ?? '');
  const [availableFlags, setAvailableFlags] = useState(
    target?.details.contentFlags ?? [],
  );
  const [contentFlags, setContentFlags] = useState(target?.details.contentFlags ?? []);
  const [newFlag, setNewFlag] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const flagsKey = target?.details.contentFlags.join('\n') ?? '';

  useEffect(() => {
    const nextFlags = flagsKey ? flagsKey.split('\n') : [];
    setTitle(target?.details.title ?? '');
    setDescription(target?.details.description ?? '');
    setAvailableFlags(nextFlags);
    setContentFlags(nextFlags);
    setNewFlag('');
    setError('');
  }, [target?.entityId, target?.details.title, target?.details.description, flagsKey]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      else dialog.removeAttribute('open');
    };
  }, [open]);

  const close = (): void => {
    if (saving) return;
    setOpen(false);
  };

  const addFlag = (): void => {
    try {
      const flags = parseContentFlags(newFlag);
      if (flags.length !== 1) throw new Error('Enter one content tag');
      const flag = flags[0]!;
      setAvailableFlags(current => [...new Set([...current, flag])]
        .sort((left, right) => left.localeCompare(right)));
      setContentFlags(current => [...new Set([...current, flag])]
        .sort((left, right) => left.localeCompare(right)));
      setNewFlag('');
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const save = async (): Promise<void> => {
    if (!target || disabled || saving) return;
    try {
      setSaving(true);
      setError('');
      await onSave({
        contentFlags: parseContentFlags(contentFlags.join('\n')),
        description,
        title: oneLine(title),
      });
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const openEditor = (): void => {
    if (!target || disabled) return;
    const nextFlags = flagsKey ? flagsKey.split('\n') : [];
    setTitle(target.details.title);
    setDescription(target.details.description);
    setAvailableFlags(nextFlags);
    setContentFlags(nextFlags);
    setNewFlag('');
    setError('');
    setOpen(true);
  };

  return <>
    <span class="world-details-summary">
      World: {target?.details.title || 'Untitled'}
    </span>
    <button
      disabled={disabled || !target}
      id={`${idPrefix}-edit-world-details`}
      title={!target ? 'World clock entity is missing' : undefined}
      type="button"
      onClick={openEditor}
    >
      Edit World Details
    </button>
    {open && <dialog
      aria-labelledby={`${idPrefix}-world-details-heading`}
      class="bl-dialog world-details-dialog"
      id={`${idPrefix}-world-details-dialog`}
      ref={dialogRef}
      onCancel={event => {
        event.preventDefault();
        close();
      }}
    >
      <form
        class="bl-dialog-form"
        onSubmit={event => {
          event.preventDefault();
          void save();
        }}
      >
        <header class="bl-dialog-header">
          <h2 id={`${idPrefix}-world-details-heading`}>World Details</h2>
        </header>
        <div class="bl-dialog-body world-details-body">
          <label class="bl-dialog-field" for={`${idPrefix}-world-title`}>
            <span>Title</span>
            <input
              autofocus
              class="world-details-title"
              disabled={saving}
              id={`${idPrefix}-world-title`}
              type="text"
              value={title}
              onInput={event => setTitle(oneLine(event.currentTarget.value))}
            />
          </label>
          <div class="world-details-description-grid">
            <label class="bl-dialog-field" for={`${idPrefix}-world-description`}>
              <span>Description (Markdown)</span>
              <textarea
                class="world-details-description"
                disabled={saving}
                id={`${idPrefix}-world-description`}
                rows={10}
                value={description}
                onInput={event => setDescription(event.currentTarget.value)}
              />
            </label>
            <section
              aria-label="Description preview"
              class="world-details-preview"
              id={`${idPrefix}-world-description-preview`}
            >
              <span class="world-details-preview-label">Preview</span>
              {description
                ? <div dangerouslySetInnerHTML={{ __html: renderMarkdown(description) }}/>
                : <p class="world-details-preview-empty">Nothing to preview yet.</p>}
            </section>
          </div>
          <fieldset class="world-details-flags">
            <legend>Content tags</legend>
            <p>Enabled tags are shown to players as content warnings.</p>
            <div class="world-details-flag-list">
              {availableFlags.length
                ? availableFlags.map((flag, index) => <label
                    class="world-details-flag"
                    for={`${idPrefix}-world-content-flag-${index}`}
                    key={flag}
                  >
                    <input
                      checked={contentFlags.includes(flag)}
                      data-content-flag={flag}
                      disabled={saving}
                      id={`${idPrefix}-world-content-flag-${index}`}
                      type="checkbox"
                      onChange={event => {
                        setContentFlags(current => event.currentTarget.checked
                          ? [...new Set([...current, flag])]
                            .sort((left, right) => left.localeCompare(right))
                          : current.filter(item => item !== flag));
                        setError('');
                      }}
                    />
                    <span>{flag}</span>
                  </label>)
                : <span class="world-details-flags-empty">No content tags added.</span>}
            </div>
            <div class="world-details-flag-entry">
              <label for={`${idPrefix}-world-content-flags`}>Add tag</label>
              <input
                disabled={saving}
                id={`${idPrefix}-world-content-flags`}
                placeholder="adult:violence"
                spellcheck={false}
                type="text"
                value={newFlag}
                onInput={event => setNewFlag(event.currentTarget.value)}
                onKeyDown={event => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  addFlag();
                }}
              />
              <button disabled={saving || !newFlag.trim()} type="button" onClick={addFlag}>
                Add
              </button>
            </div>
          </fieldset>
          {error && <span class="world-details-error" role="alert">{error}</span>}
        </div>
        <footer class="bl-dialog-actions">
          <button disabled={saving} type="button" onClick={close}>Cancel</button>
          <button
            class="bl-button-primary"
            disabled={disabled || !target || saving}
            id={`${idPrefix}-save-world-details`}
            type="submit"
          >
            {saving ? 'Saving…' : 'Save Details'}
          </button>
        </footer>
      </form>
    </dialog>}
  </>;
}
