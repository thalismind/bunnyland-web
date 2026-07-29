// Opt-in control over persisting attacker-influenceable narrative (chat transcripts,
// world/session state) to this browser's localStorage. Cached narrative is not a
// credential, but it is data remanence on shared machines, so callers can turn it off and
// clear what was already stored. This is also convenient for testing a clean device.

const REMEMBER_KEY = 'bunnyland.rememberOnThisDevice';

// localStorage key prefixes that hold narrative / per-session play state. Add new prefixes
// here when a client starts persisting server- or LLM-derived content.
const NARRATIVE_KEY_PREFIXES = ['bunnyland.characterChat.history.'];

export function rememberOnThisDevice(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setRememberOnThisDevice(remember: boolean): void {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
  } catch {
    // Local persistence is optional; the in-memory session still works.
  }
  if (!remember) {
    clearRememberedNarrative();
  }
}

export function clearRememberedNarrative(): void {
  try {
    const stale: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && NARRATIVE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        stale.push(key);
      }
    }
    for (const key of stale) {
      localStorage.removeItem(key);
    }
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
