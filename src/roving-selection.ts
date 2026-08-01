export function moveRovingSelection(
  event: KeyboardEvent,
  selector: string,
  select: (element: HTMLElement) => void,
): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const current = event.currentTarget;
  if (!(current instanceof HTMLElement)) return;
  const container = current.parentElement;
  if (!container) return;
  const items = [...container.querySelectorAll<HTMLElement>(selector)];
  const currentIndex = items.indexOf(current);
  if (currentIndex < 0 || items.length === 0) return;
  event.preventDefault();
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? items.length - 1
      : event.key === 'ArrowDown'
        ? Math.min(items.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);
  const next = items[nextIndex];
  if (!next) return;
  select(next);
  next.focus();
}
