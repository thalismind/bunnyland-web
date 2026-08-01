import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CompletionOptions,
  Transcript,
} from '../src/web-repl/live-output';
import {
  ActionSections,
  ActivityRows,
  LiveQueuedRows,
  QueuedRows,
  type TuiActionRow,
} from '../src/web-tui/live-projections';
import { useSecondBoundaryTick } from '../src/use-second-boundary-tick';

function TickProbe({ source }: { source: string }) {
  const [ticks, setTicks] = useState(0);
  useSecondBoundaryTick(() => setTicks(current => current + 1), source);
  return <output>{ticks}</output>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Web TUI live projections', () => {
  it('ticks on second boundaries, pauses while hidden, and refreshes on visibility', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.100Z'));
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const view = render(<TickProbe source="queue-1" />);
    expect(view.container.textContent).toBe('1');

    act(() => vi.advanceTimersByTime(899));
    expect(view.container.textContent).toBe('1');
    act(() => vi.advanceTimersByTime(1));
    expect(view.container.textContent).toBe('2');
    hidden = true;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.advanceTimersByTime(5000));
    expect(view.container.textContent).toBe('2');
    hidden = false;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(view.container.textContent).toBe('3');
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

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

  it('isolates countdown ticks and cleans up its timer', () => {
    vi.useFakeTimers();
    let countdown = 8;
    const view = render(<LiveQueuedRows
      countdownFor={() => countdown}
      onCancel={vi.fn()}
      rows={[{ id: 'command-1', label: 'Look' }]}
      source="queue-1"
    />);
    const originalQueue = view.container.querySelector('[data-cancel-command="command-1"]');
    countdown = 7;
    act(() => vi.advanceTimersByTime(1000));
    expect(view.container.querySelector('#queued-title')?.textContent).toContain('7s');
    expect(view.container.querySelector('[data-cancel-command="command-1"]')).toBe(originalQueue);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
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
