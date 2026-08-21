import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

const matchMobile = (): MediaQueryList | undefined =>
  typeof window === "undefined" ? undefined : window.matchMedia?.(MOBILE_QUERY);

const subscribe = (onChange: () => void) => {
  const mql = matchMobile();
  if (!mql) {
    return () => {};
  }
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
};

/**
 * Upstream's version seeds `undefined` and fills it in from an effect, which
 * costs an extra render and reads `window.innerWidth` while subscribing to a
 * media query — two sources that can disagree. `useSyncExternalStore` reads
 * the same `MediaQueryList` it listens to, and its server snapshot (`false`)
 * is what React also uses for the hydration render, so SSR output and the
 * first client render agree by construction.
 *
 * Re-applied after `yarn w @alepha/ui sync`, which overwrites `src/hooks/`.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => matchMobile()?.matches ?? false,
    () => false,
  );
}
