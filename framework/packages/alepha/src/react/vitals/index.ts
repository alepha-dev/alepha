import type { WebVital } from "alepha/vitals";

/**
 * Core Web Vitals per page, as events. Opt-in, and free of React at runtime, so
 * a module that only wants the numbers can use it without the router.
 *
 * @module alepha.react.vitals
 */
export * from "./providers/ReactVitalsProvider.ts";

declare module "alepha" {
  interface Hooks {
    /**
     * A Core Web Vital was finalised, once per metric and path. `value` is raw:
     * milliseconds, and the unitless score for `cls`. Emitted only while
     * `ReactVitalsProvider` is injected.
     */
    "react:vital:measured": WebVital;
    /**
     * The main content has painted, once per load: a timing signal, not a
     * measurement. The LCP value itself is reported when the page is hidden.
     */
    "react:lcp:painted": {};
  }
}
