import { createPrimitive, KIND, Primitive } from "alepha";

import type { SitemapPrimitiveOptions } from "./$sitemap.ts";

export type { SitemapPrimitiveOptions } from "./$sitemap.ts";

/**
 * Browser variant of {@link $sitemap}.
 *
 * The sitemap is a server-only route — there is nothing to register in the
 * client bundle, so this is a no-op primitive. It exists only to keep
 * `$sitemap()` valid as an isomorphic router field; the real implementation
 * lives in `$sitemap.ts` (server entry).
 */
export const $sitemap = (
  options: SitemapPrimitiveOptions = {},
): SitemapPrimitive => {
  return createPrimitive(SitemapPrimitive, options);
};

export class SitemapPrimitive extends Primitive<SitemapPrimitiveOptions> {
  protected onInit() {
    // no-op in the browser
  }
}

$sitemap[KIND] = SitemapPrimitive;
