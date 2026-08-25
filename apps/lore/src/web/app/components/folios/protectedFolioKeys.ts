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

/**
 * Anyone that needs to know when a key appears or disappears.
 *
 * The cache is not React state, and the auto-lock below empties it on a timer
 * with no user action behind it, so nothing re-rendered when it did. The
 * editor went on believing it was unlocked: its fields stayed editable, every
 * autosave failed with a toast, the locked panel never appeared, and a reload
 * lost whatever had been typed since the eviction.
 */
type ProtectedKeysListener = () => void;
const listeners = new Set<ProtectedKeysListener>();

const notify = (): void => {
  for (const listener of [...listeners]) listener();
};

/**
 * Subscribe to key cache changes. Returns the unsubscribe.
 *
 * @see listeners
 */
export const onProtectedKeysChange = (
  listener: ProtectedKeysListener,
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getProtectedKey = (folioId: string): CryptoKey | undefined =>
  cache.get(folioId);

export const rememberProtectedKey = (folioId: string, key: CryptoKey): void => {
  cache.set(folioId, key);
  notify();
};

export const forgetProtectedKey = (folioId: string): void => {
  if (cache.delete(folioId)) notify();
};

export const forgetAllProtectedKeys = (): void => {
  if (cache.size === 0) return;
  cache.clear();
  notify();
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
