import { $inject, Alepha, type Static } from "alepha";
import {
  type SsrManifestAtomSchema,
  ssrManifestAtom,
} from "../atoms/ssrManifestAtom.ts";
import { PAGE_PRELOAD_KEY } from "../constants/PAGE_PRELOAD_KEY.ts";
import type { PageRoute } from "./ReactPageProvider.ts";

/**
 * Provider for SSR manifest data used for module preloading.
 *
 * The manifest is populated at build time by embedding data into the
 * generated index.js via the ssrManifestAtom. This eliminates filesystem
 * reads at runtime, making it optimal for serverless deployments.
 *
 * Manifest files are generated during `vite build`:
 * - manifest.json (client manifest)
 * - ssr-manifest.json (SSR manifest)
 * - preload-manifest.json (from viteAlephaSsrPreload plugin)
 */
export class SSRManifestProvider {
  protected readonly alepha = $inject(Alepha);

  /**
   * Get the manifest from the store at runtime.
   * This ensures the manifest is available even when set after module load.
   */
  protected get manifest(): Static<SsrManifestAtomSchema> {
    return (
      (this.alepha.store.get(
        ssrManifestAtom,
      ) as Static<SsrManifestAtomSchema>) ?? {}
    );
  }

  /**
   * Get the preload manifest.
   */
  protected get preloadManifest(): PreloadManifest | undefined {
    return this.manifest.preload;
  }

  /**
   * Get the SSR manifest.
   */
  protected get ssrManifest(): SSRManifest | undefined {
    return this.manifest.ssr;
  }

  /**
   * Get the client manifest.
   */
  protected get clientManifest(): ClientManifest | undefined {
    return this.manifest.client;
  }

  /**
   * Resolve a preload key to its source path.
   *
   * The key is a short hash injected by viteAlephaSsrPreload plugin,
   * which maps to the full source path in the preload manifest.
   *
   * @param key - Short hash key (e.g., "a1b2c3d4")
   * @returns Source path (e.g., "src/pages/UserDetail.tsx") or undefined
   */
  public resolvePreloadKey(key: string): string | undefined {
    return this.preloadManifest?.[key];
  }

  /**
   * Get all chunks required for a source file, including transitive dependencies.
   *
   * Uses the client manifest to recursively resolve all imported chunks,
   * not just the direct chunks from the SSR manifest.
   *
   * @param sourcePath - Source file path (e.g., "src/pages/Home.tsx")
   * @returns Array of chunk URLs to preload, or empty array if not found
   */
  public getChunks(sourcePath: string): string[] {
    if (!this.clientManifest) {
      // Fallback to SSR manifest if client manifest not available
      return this.getChunksFromSSRManifest(sourcePath);
    }

    // Find entry in client manifest
    const entry = this.findManifestEntry(sourcePath);
    if (!entry) {
      return [];
    }

    // Recursively collect all chunks
    const chunks = new Set<string>();
    const visited = new Set<string>();

    this.collectChunksRecursive(sourcePath, chunks, visited);

    return Array.from(chunks);
  }

  /**
   * Find manifest entry for a source path, trying different extensions.
   */
  protected findManifestEntry(sourcePath: string) {
    if (!this.clientManifest) return undefined;

    // Try exact match
    if (this.clientManifest[sourcePath]) {
      return this.clientManifest[sourcePath];
    }

    // Try with different extensions
    const basePath = sourcePath.replace(/\.[^.]+$/, "");
    for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
      const pathWithExt = basePath + ext;
      if (this.clientManifest[pathWithExt]) {
        return this.clientManifest[pathWithExt];
      }
    }

    return undefined;
  }

  /**
   * Recursively collect all chunk URLs for a manifest entry.
   */
  protected collectChunksRecursive(
    key: string,
    chunks: Set<string>,
    visited: Set<string>,
  ): void {
    if (visited.has(key)) return;
    visited.add(key);

    if (!this.clientManifest) return;

    const entry = this.clientManifest[key];
    if (!entry) return;

    // Add main chunk file (with leading slash for URL)
    if (entry.file) {
      chunks.add(`/${entry.file}`);
    }

    // Add CSS files
    if (entry.css) {
      for (const css of entry.css) {
        chunks.add(`/${css}`);
      }
    }

    // Recursively process imports (but skip entry point)
    if (entry.imports) {
      for (const imp of entry.imports) {
        // Skip the main entry point (index.html) - it's already being loaded
        if (imp === "index.html" || imp.endsWith(".html")) {
          continue;
        }
        this.collectChunksRecursive(imp, chunks, visited);
      }
    }

    // Note: We intentionally do NOT follow dynamicImports
    // Those are lazy-loaded and shouldn't be preloaded
  }

  /**
   * Fallback to SSR manifest for chunk lookup.
   */
  protected getChunksFromSSRManifest(sourcePath: string): string[] {
    if (!this.ssrManifest) {
      return [];
    }

    // Try exact match
    if (this.ssrManifest[sourcePath]) {
      return this.ssrManifest[sourcePath];
    }

    // Try with different extensions
    const basePath = sourcePath.replace(/\.[^.]+$/, "");
    for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
      const pathWithExt = basePath + ext;
      if (this.ssrManifest[pathWithExt]) {
        return this.ssrManifest[pathWithExt];
      }
    }

    return [];
  }

  /**
   * Collect modulepreload links for a route and its parent chain.
   */
  public collectPreloadLinks(
    route: PageRoute,
  ): Array<{ rel: string; href: string; as?: string; crossorigin?: string }> {
    if (!this.isAvailable()) {
      return [];
    }

    const preloadPaths: string[] = [];
    let current: PageRoute | undefined = route;

    while (current) {
      const preloadKey = current[PAGE_PRELOAD_KEY];
      if (preloadKey) {
        const sourcePath = this.resolvePreloadKey(preloadKey);
        if (sourcePath) {
          preloadPaths.push(sourcePath);
        }
      }
      current = current.parent;
    }

    if (preloadPaths.length === 0) {
      return [];
    }

    const chunks = this.getChunksForMultiple(preloadPaths);

    return chunks.map((href) => {
      if (href.endsWith(".css")) {
        return { rel: "preload", href, as: "style", crossorigin: "" };
      }
      return { rel: "modulepreload", href };
    });
  }

  /**
   * Get all chunks for multiple source files.
   *
   * @param sourcePaths - Array of source file paths
   * @returns Deduplicated array of chunk URLs
   */
  public getChunksForMultiple(sourcePaths: string[]): string[] {
    const allChunks = new Set<string>();

    for (const path of sourcePaths) {
      const chunks = this.getChunks(path);
      for (const chunk of chunks) {
        allChunks.add(chunk);
      }
    }

    return Array.from(allChunks);
  }

  /**
   * Check if manifests are loaded and available.
   */
  public isAvailable(): boolean {
    return this.clientManifest !== undefined || this.ssrManifest !== undefined;
  }

  /**
   * Cached entry assets - computed once at first access.
   */
  protected cachedEntryAssets: EntryAssets | null = null;

  /**
   * Get the entry point assets (main entry.js and associated CSS files).
   *
   * These assets are always required for all pages and can be preloaded
   * before page-specific loaders run.
   *
   * @returns Entry assets with js and css paths, or null if manifest unavailable
   */
  public getEntryAssets(): EntryAssets | null {
    if (this.cachedEntryAssets) {
      return this.cachedEntryAssets;
    }

    if (!this.clientManifest) {
      return null;
    }

    // Find the entry point in the client manifest
    for (const [key, entry] of Object.entries(this.clientManifest)) {
      if (entry.isEntry) {
        this.cachedEntryAssets = {
          js: `/${entry.file}`,
          css: entry.css?.map((css) => `/${css}`) ?? [],
        };
        return this.cachedEntryAssets;
      }
    }

    return null;
  }

  /**
   * Build preload link tags for entry assets.
   *
   * @returns Array of link objects ready to be rendered
   */
  public getEntryPreloadLinks(): Array<{
    rel: string;
    href: string;
    as?: string;
    crossorigin?: string;
  }> {
    const assets = this.getEntryAssets();
    if (!assets) {
      return [];
    }

    const links: Array<{
      rel: string;
      href: string;
      as?: string;
      crossorigin?: string;
    }> = [];

    // Add CSS preloads first (critical for rendering)
    for (const css of assets.css) {
      links.push({ rel: "stylesheet", href: css, crossorigin: "" });
    }

    // Add entry JS modulepreload
    if (assets.js) {
      links.push({ rel: "modulepreload", href: assets.js });
    }

    return links;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Entry assets structure containing the main entry JS and associated CSS files.
 */
export interface EntryAssets {
  /** Main entry JavaScript file (e.g., "/assets/entry.abc123.js") */
  js?: string;
  /** Associated CSS files (e.g., ["/assets/style.abc123.css"]) */
  css: string[];
}

/**
 * SSR Manifest structure from Vite.
 * Maps source file paths to their required chunks/assets.
 */
export type SSRManifest = Record<string, string[]>;

/**
 * Client manifest structure from Vite.
 * Maps source files to their output information.
 */
export interface ClientManifest {
  [key: string]: {
    file: string;
    src?: string;
    isEntry?: boolean;
    isDynamicEntry?: boolean;
    imports?: string[];
    dynamicImports?: string[];
    css?: string[];
    assets?: string[];
  };
}

/**
 * Preload manifest mapping short keys to source paths.
 * Generated by viteAlephaSsrPreload plugin at build time.
 */
export type PreloadManifest = Record<string, string>;
