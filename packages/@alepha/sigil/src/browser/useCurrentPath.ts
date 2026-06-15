import { useSyncExternalStore } from "react";

/**
 * Custom event fired by the patched History methods below. `pushState` /
 * `replaceState` do NOT emit `popstate`, so SPA navigations would otherwise go
 * unnoticed — this bridges them to a regular DOM event subscribers can listen
 * to.
 */
const LOCATION_CHANGE_EVENT = "alepha:sigil:locationchange";

let historyPatched = false;

/**
 * Patch `history.pushState` / `history.replaceState` once so client-side
 * navigations notify {@link useCurrentPath} subscribers. Idempotent and
 * best-effort — the wrapped methods still perform the real navigation, they
 * just dispatch an extra event afterwards. No-op on the server.
 */
const ensureHistoryPatched = (): void => {
  if (historyPatched) return;
  if (typeof window === "undefined" || typeof window.history === "undefined") {
    return;
  }
  historyPatched = true;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method];
    window.history[method] = function patched(
      this: History,
      ...args: Parameters<History["pushState"]>
    ) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
      return result;
    } as History[typeof method];
  }
};

const subscribe = (onChange: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  ensureHistoryPatched();
  window.addEventListener("popstate", onChange);
  window.addEventListener(LOCATION_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(LOCATION_CHANGE_EVENT, onChange);
  };
};

const getSnapshot = (): string =>
  typeof window === "undefined" ? "/" : window.location.pathname;

const getServerSnapshot = (): string => "/";

/**
 * The current `window.location.pathname`, re-rendering on SPA navigation
 * (`history.pushState` / `replaceState`) and back/forward (`popstate`).
 * Framework-agnostic: it observes the History API directly rather than any
 * specific router, so it works for any app embedding the sigil.
 */
export const useCurrentPath = (): string =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
