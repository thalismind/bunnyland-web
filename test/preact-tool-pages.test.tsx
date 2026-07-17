import { fireEvent, render } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import { ToolLinks } from '../src/index/tool-links';
import { SpanRows, type TraceSpanRow } from '../src/trace-analyzer/span-rows';
import { ActionRows, TargetRows } from '../src/web-repl/context-lists';
import { MemberList } from '../src/web-tui/world-lists';

describe('trace analyzer span rows', () => {
  const span: TraceSpanRow = {
    childCount: 1,
    className: 'root',
    depth: 0,
    duration: '10ms',
    durationClassName: 'root',
    durationLeft: '0%',
    durationWidth: '50%',
    id: 'span-1',
    labelLeft: '0%',
    name: 'tick',
    selected: false,
    service: 'bunnyland',
  };

  it('retains keyed span nodes when selection and timing update', () => {
    const view = render(<SpanRows rows={[span]} />);
    const original = view.container.querySelector('[data-span-id="span-1"]');
    view.rerender(<SpanRows rows={[{
      ...span, durationLeft: '25%', durationWidth: '25%', selected: true,
    }]} />);
    const updated = view.container.querySelector('[data-span-id="span-1"]');
    expect(updated).toBe(original);
    expect(updated?.classList.contains('selected')).toBe(true);
    expect((updated?.querySelector('.span-duration') as HTMLElement).style.left).toBe('25%');
  });
});

describe('web TUI world lists', () => {
  it('retains members by entity id and preserves the data selector click contract', () => {
    const onSelect = vi.fn();
    const member = {
      icon: '🐇', id: 'character-1', isPlayer: false, kind: 'character',
      label: 'Juniper', selected: false,
    };
    const view = render(<MemberList empty="empty" items={[member]} onSelect={onSelect} />);
    const original = view.container.querySelector('[data-entity="character-1"]');
    view.rerender(<MemberList empty="empty" items={[{ ...member, selected: true }]} onSelect={onSelect} />);
    const updated = view.container.querySelector('[data-entity="character-1"]');
    expect(updated).toBe(original);
    expect(updated?.classList.contains('selected')).toBe(true);
    fireEvent.click(updated!);
    expect(onSelect).toHaveBeenCalledWith('character-1');
  });
});

describe('web REPL context lists', () => {
  it('retains action and target rows by their durable command and entity keys', () => {
    const action = {
      available: true, icon: '👀', key: 'immediate:look', label: 'look', meta: 'free', reason: '',
    };
    const actions = render(<ActionRows actions={[action]} />);
    const originalAction = actions.container.querySelector('[data-action-key="immediate:look"]');
    actions.rerender(<ActionRows actions={[{ ...action, available: false, reason: 'waiting' }]} />);
    expect(actions.container.querySelector('[data-action-key="immediate:look"]')).toBe(originalAction);

    const target = { key: 'character-1', kind: 'character', label: 'Juniper' };
    const targets = render(<TargetRows targets={[target]} />);
    const originalTarget = targets.container.querySelector('[data-target-key="character-1"]');
    targets.rerender(<TargetRows targets={[{ ...target, label: 'Juniper Rabbit' }]} />);
    expect(targets.container.querySelector('[data-target-key="character-1"]')).toBe(originalTarget);
  });
});

describe('landing tool links', () => {
  it('keeps link URLs and keyed cards stable when labels update', () => {
    const link = {
      description: 'Inspect traces.', href: 'trace-analyzer.html', label: 'Open Trace Analyzer', title: 'Trace Analyzer',
    };
    const view = render(<ToolLinks links={[link]} />);
    const original = view.container.querySelector('[data-tool-href="trace-analyzer.html"]');
    expect(view.getByRole('link').getAttribute('href')).toBe('trace-analyzer.html');
    view.rerender(<ToolLinks links={[{ ...link, description: 'Inspect live traces.' }]} />);
    expect(view.container.querySelector('[data-tool-href="trace-analyzer.html"]')).toBe(original);
  });
});
