import { $hook, $inject, Alepha } from "alepha";

import { SSRManifestProvider } from "./SSRManifestProvider.ts";

/**
 * Adds HTTP Link headers for preloading entry assets.
 *
 * Benefits:
 * - Early Hints (103): Servers can send preload hints before the full response
 * - CDN optimization: Many CDNs use Link headers to optimize asset delivery
 * - Browser prefetching: Browsers can start fetching resources earlier
 *
 * The Link header is computed once at first request and cached for reuse.
 */
export class ReactPreloadProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly ssrManifest = $inject(SSRManifestProvider);

  /**
   * Cached Link header value - computed once, reused for all requests.
   */
  protected cachedLinkHeader: string | null | undefined;

  /**
   * Build the Link header string from entry assets.
   *
   * Format: <url>; rel=preload; as=type, <url>; rel=modulepreload
   *
   * @returns Link header string or null if no assets
   */
  protected buildLinkHeader(): string | null {
    const assets = this.ssrManifest.getEntryAssets();
    if (!assets) return null;

    const links: string[] = [];

    // CSS - preload as style
    for (const css of assets.css) {
      links.push(`<${css}>; rel=preload; as=style`);
    }

    // JS - modulepreload for ES modules
    if (assets.js) {
      links.push(`<${assets.js}>; rel=modulepreload`);
    }

    return links.length > 0 ? links.join(", ") : null;
  }

  /**
   * Get the cached Link header, computing it on first access.
   */
  protected getLinkHeader(): string | null {
    if (this.cachedLinkHeader === undefined) {
      this.cachedLinkHeader = this.buildLinkHeader();
    }
    return this.cachedLinkHeader;
  }

  /**
   * Add Link header to HTML responses for asset preloading.
   */
  protected readonly onResponse = $hook({
    on: "server:onResponse",
    priority: "first",
    handler: ({ response }) => {
      // Only add to HTML responses (SSR pages)
      const contentType = response.headers["content-type"];
      if (!contentType?.includes("text/html")) {
        return;
      }

      const linkHeader = this.getLinkHeader();
      if (!linkHeader) {
        return;
      }

      // Append to existing Link header if present
      if (response.headers.link) {
        response.headers.link = `${response.headers.link}, ${linkHeader}`;
      } else {
        response.headers.link = linkHeader;
      }
    },
  });
}
