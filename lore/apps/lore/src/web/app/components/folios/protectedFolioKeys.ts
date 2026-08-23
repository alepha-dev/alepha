/**
 * Module-local cache of derived `CryptoKey` instances for protected
 * folios in the current session. NOT a store atom: `CryptoKey` is an
 * opaque host object that won't serialize, and we explicitly DON'T want
 * persistence — the cache must vanish on tab close so a second visitor
 * can't skip the passphrase prompt.
 *
 * The map is shared across renders of the folio workspace so a user who
 * unlocked a folio once does not re-enter the passphrase on every
 * navigation back to it.
 */
const cache = new Map<string, CryptoKey>();

export const getProtectedKey = (folioId: string): CryptoKey | undefined =>
  cache.get(folioId);

export const rememberProtectedKey = (folioId: string, key: CryptoKey): void => {
  cache.set(folioId, key);
};

export const forgetProtectedKey = (folioId: string): void => {
  cache.delete(folioId);
};

export const forgetAllProtectedKeys = (): void => {
  cache.clear();
};

/**
 * Install a global inactivity watcher that wipes the entire cache after
 * `idleMs` of no user input (mouse / keyboard / touch). Idempotent —
 * calling twice from React strict-mode mounts won't double-arm. Auto-
 * wires the listeners on first call, never tears them down (the tab is
 * the lifetime).
 */
let armed = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const DEFAULT_IDLE_MS = 15 * 60 * 1000;

export const ensureProtectedKeysAutoLock = (idleMs = DEFAULT_IDLE_MS): void => {
  if (typeof window === "undefined") return;
  if (armed) return;
  armed = true;
  const reset = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      forgetAllProtectedKeys();
    }, idleMs);
  };
  for (const evt of ["mousemove", "keydown", "touchstart"] as const) {
    window.addEventListener(evt, reset, { passive: true });
  }
  // Clear keys aggressively when the tab is hidden long enough — if the
  // user closes the laptop and walks away, the next visibility change
  // wipes without waiting for the full idle window.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      // Don't wipe immediately — the user may come back in seconds.
      // Re-arm a shorter timer instead; if the tab is hidden for
      // `idleMs / 3`, clear.
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => {
          forgetAllProtectedKeys();
        },
        Math.floor(idleMs / 3),
      );
    } else {
      reset();
    }
  });
  reset();
};
