import { useEffect, useState } from 'preact/hooks';

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

export function WorldDetailsEditor({
  disabled = false,
  idPrefix,
  onSave,
  target,
}: WorldDetailsEditorProps) {
  const [title, setTitle] = useState(target?.details.title ?? '');
  const [description, setDescription] = useState(target?.details.description ?? '');
  const [contentFlags, setContentFlags] = useState(
    target?.details.contentFlags.join(', ') ?? '',
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const flagsKey = target?.details.contentFlags.join('\n') ?? '';

  useEffect(() => {
    setTitle(target?.details.title ?? '');
    setDescription(target?.details.description ?? '');
    setContentFlags(flagsKey.split('\n').join(', '));
    setError('');
  }, [target?.entityId, target?.details.title, target?.details.description, flagsKey]);

  const save = async (): Promise<void> => {
    if (!target || disabled || saving) return;
    try {
      setSaving(true);
      setError('');
      await onSave({
        contentFlags: parseContentFlags(contentFlags),
        description,
        title,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return <>
    <span class="world-details-label">World details:</span>
    <label for={`${idPrefix}-world-title`}>Title</label>
    <input
      class="world-details-title"
      disabled={disabled || !target}
      id={`${idPrefix}-world-title`}
      type="text"
      value={title}
      onInput={event => setTitle(event.currentTarget.value)}
    />
    <label for={`${idPrefix}-world-description`}>Description</label>
    <input
      class="world-details-description"
      disabled={disabled || !target}
      id={`${idPrefix}-world-description`}
      type="text"
      value={description}
      onInput={event => setDescription(event.currentTarget.value)}
    />
    <label for={`${idPrefix}-world-content-flags`}>Content flags</label>
    <input
      class="world-details-flags"
      disabled={disabled || !target}
      id={`${idPrefix}-world-content-flags`}
      placeholder="adult:violence, pvp"
      spellcheck={false}
      type="text"
      value={contentFlags}
      onInput={event => setContentFlags(event.currentTarget.value)}
    />
    <button
      disabled={disabled || !target || saving}
      id={`${idPrefix}-save-world-details`}
      type="button"
      onClick={() => { void save(); }}
    >
      {saving ? 'Saving…' : 'Save Details'}
    </button>
    {!target && <span class="world-details-error">World clock entity is missing.</span>}
    {error && <span class="world-details-error" role="alert">{error}</span>}
  </>;
}
