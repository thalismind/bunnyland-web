import { fireEvent, render } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import {
  CompletionOptions,
  Transcript,
} from '../src/web-repl/live-output';
import {
  ActionSections,
  ActivityRows,
  QueuedRows,
  type TuiActionRow,
} from '../src/web-tui/live-projections';

describe('Web TUI live projections', () => {
  it('keeps activity, action, and queue nodes stable through projection updates', () => {
    const activity = render(<ActivityRows rows={[{
      icon: '👀', key: 'event-1', kind: 'event', text: 'Juniper looks around.',
    }]} />);
    const originalActivity = activity.container.querySelector('[data-activity-key="event-1"]');
    activity.rerender(<ActivityRows rows={[{
      icon: '', key: 'event-1', kind: 'event', text: 'Juniper looks around.',
    }]} />);
    expect(activity.container.querySelector('[data-activity-key="event-1"]')).toBe(originalActivity);

    const onAction = vi.fn();
    const action: TuiActionRow = {
      actionCost: 1,
      available: true,
      focusCost: 0,
      icon: '👀',
      index: 0,
      key: 'world:look',
      lane: 'world',
      ready: true,
      reason: '',
      target: false,
      title: 'Look',
    };
    const actions = render(<ActionSections actions={[action]} onAction={onAction} />);
    const originalAction = actions.container.querySelector('[data-action-key="world:look"]');
    actions.rerender(<ActionSections actions={[{ ...action, available: false, reason: 'waiting' }]} onAction={onAction} />);
    const updatedAction = actions.container.querySelector('[data-action-key="world:look"]');
    expect(updatedAction).toBe(originalAction);
    fireEvent.click(updatedAction!);
    expect(onAction).toHaveBeenCalledWith(0);

    const onCancel = vi.fn();
    const queued = render(<QueuedRows countdown={8} onCancel={onCancel} rows={[{ id: 'command-1', label: 'Look' }]} />);
    const originalQueue = queued.container.querySelector('[data-cancel-command="command-1"]');
    const originalTitle = queued.container.querySelector('#queued-title');
    queued.rerender(<QueuedRows countdown={7} onCancel={onCancel} rows={[{ id: 'command-1', label: 'Look' }]} />);
    const updatedQueue = queued.container.querySelector('[data-cancel-command="command-1"]');
    expect(updatedQueue).toBe(originalQueue);
    expect(queued.container.querySelector('#queued-title')).toBe(originalTitle);
    fireEvent.click(updatedQueue!);
    expect(onCancel).toHaveBeenCalledWith('command-1');
  });
});

describe('Web REPL live output', () => {
  it('keeps transcript rows stable when output is appended, including delegated link markup', () => {
    const first = { id: 1, kind: 'command', value: '> look' };
    const view = render(<Transcript rows={[first]} />);
    const original = view.container.querySelector('[data-log-id="1"]');
    view.rerender(<Transcript rows={[
      first,
      { id: 2, kind: 'ok', parts: [{ insert: 'Juniper', kind: 'entity' as const, label: 'Juniper' }] },
    ]} />);
    expect(view.container.querySelector('[data-log-id="1"]')).toBe(original);
    expect(view.container.querySelector('.entity-link')?.getAttribute('data-insert')).toBe('Juniper');
  });

  it('updates keyed completions without replacing or blurring the prompt', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    const view = render(<datalist><CompletionOptions values={['look', 'lock']} /></datalist>);
    const original = view.container.querySelector('option[value="look"]');
    view.rerender(<datalist><CompletionOptions values={['look', 'leave']} /></datalist>);

    expect(view.container.querySelector('option[value="look"]')).toBe(original);
    expect(document.activeElement).toBe(input);
    input.remove();
  });
});
