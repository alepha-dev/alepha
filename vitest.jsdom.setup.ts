/**
 * What jsdom does not implement, and every themed component expects.
 *
 * Loaded by `jsdomProject` for the whole browser test project, for the same
 * reason `execArgv` lives there: a shim added to one spec is a shim the next
 * one has to rediscover, and there are two vitest configs in this repo that
 * cannot see each other's settings.
 */

/**
 * `window.matchMedia` is absent from jsdom entirely. Anything that asks the
 * platform a question about the viewport or the user's preferences reaches
 * for it on mount and throws — sonner's `<Toaster>` does, which is what makes
 * "did this action toast?" untestable without this.
 *
 * Everything reports as not matching: a test asserting on responsive or
 * reduced-motion behaviour should emulate it explicitly rather than inherit a
 * default from here.
 */
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
