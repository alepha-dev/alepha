/**
 * Symbol key for SSR module preloading path.
 * Using Symbol.for() allows the Vite plugin to inject this at build time.
 * @internal
 */
export const PAGE_PRELOAD_KEY = Symbol.for("alepha.page.preload");
