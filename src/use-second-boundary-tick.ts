import { useEffect, useRef } from 'preact/hooks';

export function nextSecondDelay(now = Date.now()): number {
  const remainder = now % 1000;
  return remainder === 0 ? 1000 : 1000 - remainder;
}

export function useSecondBoundaryTick(callback: () => void, source: unknown): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    let timer: number | null = null;
    const stop = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const schedule = (): void => {
      stop();
      if (document.hidden) return;
      timer = window.setTimeout(tick, nextSecondDelay());
    };
    const tick = (): void => {
      callbackRef.current();
      schedule();
    };
    const onVisibility = (): void => {
      if (document.hidden) stop();
      else tick();
    };
    tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [source]);
}
