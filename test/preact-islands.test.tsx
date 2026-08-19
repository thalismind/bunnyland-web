import { fireEvent, render } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import { EntityList } from '../src/world-editor/entity-list';
import { StageItems } from '../src/toon-client/stage';

describe('EntityList', () => {
  it('renders typed entity metadata and selects by stable entity id', () => {
    const onSelect = vi.fn();
    const view = render(<EntityList
      entities={[{
        id: 'bunny-1', icon: '🐰', invalid: true, name: 'Clover', type: 'character',
      }]}
      onSelect={onSelect}
      selectedId="bunny-1"
    />);

    const row = view.getByText('Clover').closest('.entity-row');
    expect(row?.classList.contains('active')).toBe(true);
    expect(view.getByText('invalid ·')).toBeTruthy();
    fireEvent.click(row!);
    expect(onSelect).toHaveBeenCalledWith('bunny-1');
  });

  it('retains keyed rows when only selection changes', () => {
    const props = {
      entities: [{ id: 'bunny-1', icon: '🐰', invalid: false, name: 'Clover', type: 'character' }],
      onSelect: vi.fn(),
    };
    const view = render(<EntityList {...props} selectedId={null} />);
    const original = view.container.querySelector('[data-id="bunny-1"]');
    view.rerender(<EntityList {...props} selectedId="bunny-1" />);
    expect(view.container.querySelector('[data-id="bunny-1"]')).toBe(original);
  });

  it('supports roving keyboard selection and exposes selected state', () => {
    const onSelect = vi.fn();
    const entities = [
      { id: 'one', icon: '1', invalid: false, name: 'One', type: 'room' },
      { id: 'two', icon: '2', invalid: false, name: 'Two', type: 'room' },
    ];
    const view = render(<div role="listbox"><EntityList entities={entities} onSelect={onSelect} selectedId="one" /></div>);
    const first = view.container.querySelector<HTMLElement>('[data-id="one"]')!;
    const second = view.container.querySelector<HTMLElement>('[data-id="two"]')!;
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenCalledWith('two');
    expect(document.activeElement).toBe(second);
    expect(first.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(second, { key: 'Home' });
    expect(document.activeElement).toBe(first);
  });
});

describe('StageItems', () => {
  it('retains keyed sprites while their projected position changes', () => {
    const sprite = {
      glyph: '🐰', id: 'bunny-1', isPlayer: true, label: 'Clover', layer: 20,
      left: 10, scale: 1, selected: false, top: 20,
    };
    const props = { doors: [], onDoor: vi.fn(), onSprite: vi.fn() };
    const view = render(<StageItems {...props} sprites={[sprite]} />);
    const original = view.container.querySelector('[data-id="bunny-1"]');
    view.rerender(<StageItems {...props} sprites={[{ ...sprite, left: 30 }]} />);
    const updated = view.container.querySelector('[data-id="bunny-1"]');
    expect(updated).toBe(original);
    expect((updated as HTMLElement).style.left).toBe('30px');
  });

  it('exposes sprites and doors as keyboard-operable buttons with state', () => {
    const onDoor = vi.fn();
    const onSprite = vi.fn();
    const sprite = {
      glyph: '🐰', id: 'bunny-1', isPlayer: false, label: 'Clover', layer: 20,
      left: 10, scale: 1, selected: true, top: 20,
    };
    const view = render(<StageItems
      doors={[{
        direction: 'north', id: 'door-1', label: 'Garden', position: { top: '14px' },
        title: 'Walk through Garden',
      }, {
        direction: 'south', disabled: true, id: 'door-2', label: 'Cellar',
        position: { bottom: '14px' }, title: 'Cannot walk through Cellar right now',
      }]}
      onDoor={onDoor}
      onSprite={onSprite}
      sprites={[sprite]}
    />);

    const spriteButton = view.getByRole('button', { name: 'Clear target Clover' });
    expect(spriteButton.getAttribute('aria-pressed')).toBe('true');
    spriteButton.focus();
    fireEvent.keyDown(spriteButton, { key: 'Enter' });
    fireEvent.click(spriteButton);
    expect(onSprite).toHaveBeenCalledWith('bunny-1');

    const door = view.getByRole('button', { name: 'Walk through Garden' });
    fireEvent.click(door);
    expect(onDoor).toHaveBeenCalledWith('door-1');
    expect(view.getByRole('button', { name: 'Cannot walk through Cellar right now' }).hasAttribute('disabled')).toBe(true);
  });
});
