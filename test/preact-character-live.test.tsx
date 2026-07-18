import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';

import { Overview, PillList, SheetList } from '../src/character/sections';
import { Transcript, type TranscriptItem } from '../src/character/transcript';

describe('Transcript', () => {
  it('keeps keyed messages while safe markdown output and action state update', () => {
    const items: TranscriptItem[] = [{
      html: '<strong>safe</strong> &lt;img src=x onerror=alert(1)&gt;',
      key: 'character:reply-1:0',
      kind: 'message',
      plain: false,
      role: 'character',
    }, {
      commandId: 'command:remember-1', icon: '🧠', key: 'action:command:remember-1:0',
      kind: 'action', status: 'queued', text: 'remember queued', tool: 'remember',
    }];
    const view = render(<Transcript emptyMessage="Empty" items={items} />);
    const message = view.container.querySelector('[data-message-key="character:reply-1:0"]');
    const action = view.container.querySelector('[data-command-id="command:remember-1"]');
    expect(message?.querySelector('strong')?.textContent).toBe('safe');
    expect(message?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(message?.querySelector('img')).toBeNull();

    view.rerender(<Transcript emptyMessage="Empty" items={[
      { ...items[0]!, plain: true },
      { ...items[1]!, status: 'executed', text: 'remember finished' },
    ]} />);
    expect(view.container.querySelector('[data-message-key="character:reply-1:0"]')).toBe(message);
    const updatedAction = view.container.querySelector('[data-command-id="command:remember-1"]');
    expect(updatedAction).toBe(action);
    expect(updatedAction?.classList.contains('executed')).toBe(true);
    expect(updatedAction?.textContent).toContain('finished');
  });

  it('does not steal focus from the chat composer during live updates', () => {
    const composer = document.createElement('textarea');
    document.body.append(composer);
    composer.focus();
    const item: TranscriptItem = {
      html: 'first', key: 'user:first:0', kind: 'message', plain: true, role: 'user',
    };
    const view = render(<Transcript emptyMessage="Empty" items={[item]} />);
    view.rerender(<Transcript emptyMessage="Empty" items={[item, {
      html: 'reply', key: 'character:reply:0', kind: 'message', plain: true, role: 'character',
    }]} />);
    expect(document.activeElement).toBe(composer);
    composer.remove();
  });
});

describe('character sheet sections', () => {
  it('keeps keyed rows and pills while live values change', () => {
    const row = { key: 'item:brass-key', label: 'a brass key', meta: 'item' };
    const rows = render(<SheetList emptyMessage="No items." rows={[row]} />);
    const original = rows.container.querySelector('[data-row-key="item:brass-key"]');
    rows.rerender(<SheetList emptyMessage="No items." rows={[{ ...row, meta: 'equipped item' }]} />);
    const updated = rows.container.querySelector('[data-row-key="item:brass-key"]');
    expect(updated).toBe(original);
    expect(updated?.textContent).toContain('equipped item');

    const pills = render(<PillList emptyMessage="No traits." values={['watchful']} />);
    const originalPill = pills.container.querySelector('[data-pill="watchful"]');
    pills.rerender(<PillList emptyMessage="No traits." values={['watchful', 'local']} />);
    expect(pills.container.querySelector('[data-pill="watchful"]')).toBe(originalPill);
  });

  it('renders overview text as text and preserves filter focus across list refreshes', () => {
    const overview = render(<Overview
      emptyMessage="No notes."
      overview={{ description: '<img src=x onerror=alert(1)>', tags: ['scout'] }}
    />);
    expect(overview.container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(overview.container.querySelector('img')).toBeNull();

    const filter = document.createElement('input');
    document.body.append(filter);
    filter.focus();
    const actions = render(<SheetList emptyMessage="No actions." rows={[{
      key: 'say:say', label: 'Say', meta: 'world · 1 AP',
    }]} />);
    actions.rerender(<SheetList emptyMessage="No matching actions." rows={[]} />);
    expect(actions.getByText('No matching actions.')).toBeTruthy();
    expect(document.activeElement).toBe(filter);
    filter.remove();
  });
});
