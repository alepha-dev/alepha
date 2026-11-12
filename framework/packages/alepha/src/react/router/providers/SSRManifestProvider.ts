import { $inject, Alepha, type Infer } from "alepha";
import type { HeadLinkCrossOrigin } from "alepha/react/head";

import {
  type SsrManifestAtomSchema,
  ssrManifestAtom,
} from "../atoms/ssrManifestAtom.ts";
import { PAGE_PRELOAD_KEY } from "../constants/PAGE_PRELOAD_KEY.ts";
import type { PageRoute } from "./ReactPageProvider.ts";

/**
 * Provider for SSR manifest data used for module preloading.
 *
 * Every answer here was resolved by the build and embedded into the generated
 * index.js, so this is a table lookup rather than a graph walk. It used to be
 * the latter: the whole Vite client manifest travelled inside the server
 * bundle, and each request walked 80 to 118 chunks of it to rebuild a fragment
 * that cannot vary by request.
 */
export class SSRManifestProvider {
  protected readonly alepha = $inject(Alepha);

  /**
   * Get the manifest from the store at runtime.
   * This ensures the manifest is available even when set after module load.
   */
  protected get manifest(): Infer<SsrManifestAtomSchema> {
    return (
      (this.alepha.store.get(
        ssrManifestAtom,
      ) as Infer<SsrManifestAtomSchema>) ?? {}
    );
  }

  /**
   * Get the full manifest object.
   */
  public getManifest(): Infer<SsrManifestAtomSchema> {
    return this.manifest;
  }

  /**
   * The precomputed preload table, when this is a built application.
   */
  protected get table(): PreloadTable | undefined {
    return this.manifest.preload;
  }

  /**
   * Check if the preload table is available. It is not in dev, where Vite
   * serves modules itself and there is no build to precompute anything.
   */
  public isAvailable(): boolean {
    return this.table !== undefined;
  }

  /**
   * Collect modulepreload links for a route and its parent chain.
   */
  public collectPreloadLinks(route: PageRoute): PreloadLink[] {
    const table = this.table;
    if (!table) return [];

    const indexes = new Set<number>();
    let current: PageRoute | undefined = route;

    while (current) {
      const preloadKey = current[PAGE_PRELOAD_KEY];
      if (preloadKey) {
        for (const index of table.keys[preloadKey] ?? []) {
          indexes.add(index);
        }
      }
      current = current.parent;
    }

    return this.linksOf(table, indexes);
  }

  /**
   * The entry point's own static graph, as preload links.
   *
   * Everything here is needed by every page, so it belongs in the early head
   * beside the entry script rather than behind the loaders. Without it, the
   * chunks reachable only by parsing `entry.js` cost two extra sequential
   * round trips before hydration can finish.
   */
  public collectEntryGraphLinks(): PreloadLink[] {
    const table = this.table;
    if (!table?.entry) return [];

    return this.linksOf(table, new Set(table.entry.graph));
  }

  /**
   * Get the entry point assets (main entry.js and associated CSS files).
   *
   * These assets are always required for all pages and can be preloaded
   * before page-specific loaders run.
   *
   * @returns Entry assets with js and css paths, or null if unavailable
   */
  public getEntryAssets(): EntryAssets | null {
    const entry = this.table?.entry;
    if (!entry) return null;

    const files = this.table!.files;

    return {
      js: entry.js === undefined ? undefined : files[entry.js],
      jsIntegrity:
        entry.js === undefined ? undefined : this.integrityOf(entry.js),
      css: entry.css.map((index) => files[index]),
      cssIntegrity: entry.css.map((index) => this.integrityOf(index)),
    };
  }

  /**
   * The Subresource Integrity of a file of the preload table, or nothing
   * when the build recorded none (dev, a build before #Q3319).
   */
  public integrityOf(index: number): string | undefined {
    return this.table?.integrity?.[index] || undefined;
  }

  /**
   * Turn a set of file indexes into head links.
   *
   * A stylesheet must carry `crossorigin` to match Vite's own dynamic CSS
   * loading, which always uses `crossorigin=""`.
   */
  protected linksOf(table: PreloadTable, indexes: Set<number>): PreloadLink[] {
    const links: PreloadLink[] = [];

    for (const index of indexes) {
      const href = table.files[index];
      if (!href) continue;

      // A module is integrity-checked only if its `modulepreload` is
      // processed before something imports it, which is why the server
      // writes the entry's graph ahead of the entry script.
      const integrity = this.integrityOf(index);
      if (href.endsWith(".css")) {
        // No integrity on a style preload: the stylesheet that consumes it is
        // inserted by Vite's own CSS loader, with no `integrity`, and a
        // browser then discards a preload whose integrity differs ("not used
        // due to an integrity mismatch") and downloads the file again. A page
        // stylesheet is, like a lazy chunk, authorised by the CSP only.
        links.push({ rel: "preload", href, as: "style", crossorigin: true });
      } else {
        links.push({
          rel: "modulepreload",
          href,
          ...(integrity ? { integrity } : {}),
        });
      }
    }

    return links;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * A link the SSR head carries for one asset.
 */
export interface PreloadLink {
  rel: string;
  href: string;
  as?: string;
  crossorigin?: HeadLinkCrossOrigin;
  integrity?: string;
}

/**
 * Entry assets structure containing the main entry JS and associated CSS files.
 */
export interface EntryAssets {
  /**
   * Main entry JavaScript file (e.g., "/assets/entry.abc123.js")
   */
  js?: string;
  /**
   * Subresource Integrity of {@link js}, when the build recorded it.
   */
  jsIntegrity?: string;
  /**
   * Associated CSS files (e.g., ["/assets/style.abc123.css"])
   */
  css: string[];
  /**
   * Subresource Integrity of each of {@link css}, parallel to it.
   */
  cssIntegrity?: Array<string | undefined>;
}

/**
 * The precomputed preload table, as the build embeds it.
 */
export type PreloadTable = NonNullable<Infer<SsrManifestAtomSchema>["preload"]>;
