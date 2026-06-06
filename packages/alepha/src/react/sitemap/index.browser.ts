import { $module } from "alepha";
import { $sitemap } from "./primitives/$sitemap.browser.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$sitemap.browser.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Sitemap generation for React applications (browser entry).
 *
 * The sitemap route only exists server-side, so the browser build ships a
 * no-op {@link $sitemap}. See the server entry for the real implementation.
 *
 * @module alepha.react.sitemap
 */
export const AlephaReactSitemap = $module({
  name: "alepha.react.sitemap",
  primitives: [$sitemap],
});
