import { $module } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaServer } from "alepha/server";
import { $sitemap } from "./primitives/$sitemap.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$sitemap.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Sitemap generation for React applications.
 *
 * Exposes the {@link $sitemap} primitive, which serves a `sitemap.xml` built
 * from the app's `$page` primitives - live at request time and prerendered to a
 * static file at build time.
 *
 * @module alepha.react.sitemap
 */
export const AlephaReactSitemap = $module({
  name: "alepha.react.sitemap",
  imports: [AlephaServer, AlephaDateTime],
  primitives: [$sitemap],
});
