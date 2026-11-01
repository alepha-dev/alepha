import { $module } from "alepha";

import { $manifest } from "./primitives/$manifest.browser.ts";
import { $robots } from "./primitives/$robots.browser.ts";
import { $sitemap } from "./primitives/$sitemap.browser.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$manifest.browser.ts";
export * from "./primitives/$robots.browser.ts";
export * from "./primitives/$sitemap.browser.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Sitemap generation for React applications (browser entry).
 *
 * These routes only exist server-side, so the browser build ships a no-op
 * {@link $sitemap} and {@link $robots}, and a {@link $manifest} that keeps its
 * head link. See the server entry for the real implementation.
 *
 * @module alepha.react.sitemap
 */
export const AlephaReactSitemap = $module({
  name: "alepha.react.sitemap",
  primitives: [$sitemap, $robots, $manifest],
});
