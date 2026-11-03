import { $module } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaReactRouter } from "alepha/react/router";
import { AlephaServer } from "alepha/server";

import { $manifest } from "./primitives/$manifest.ts";
import { $robots } from "./primitives/$robots.ts";
import { $sitemap } from "./primitives/$sitemap.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$manifest.ts";
export * from "./primitives/$robots.ts";
export * from "./primitives/$sitemap.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Sitemap, robots and web app manifest generation for React applications.
 *
 * Exposes the {@link $sitemap} primitive, which serves a `sitemap.xml` built
 * from the app's `$page` primitives - live at request time and prerendered to a
 * static file at build time - {@link $robots}, a `robots.txt` that answers by
 * host, and {@link $manifest}.
 *
 * @module alepha.react.sitemap
 */
export const AlephaReactSitemap = $module({
  name: "alepha.react.sitemap",
  // The router is a real dependency, not an assumption: the sitemap lists the
  // paths `ReactPageProvider` compiled, which is the only place a nested page's
  // full URL exists.
  imports: [AlephaServer, AlephaDateTime, AlephaReactRouter],
  primitives: [$sitemap, $robots, $manifest],
});
