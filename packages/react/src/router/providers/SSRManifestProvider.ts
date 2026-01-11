import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";

/**
 * SSR Manifest structure from Vite.
 *
 * Maps source file paths to their required chunks/assets.
 */
export type SSRManifest = Record<string, string[]>;

/**
 * Client manifest structure from Vite.
 *
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
 * Provider for loading and managing Vite's SSR manifest.
 *
 * The SSR manifest maps source files to their required chunks,
 * enabling module preloading during SSR streaming.
 *
 * Manifest files are generated during `vite build` when:
 * - `build.manifest: true` (generates .vite/manifest.json)
 * - `build.ssrManifest: true` (generates .vite/ssr-manifest.json)
 */
export class SSRManifestProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);

  protected ssrManifest: SSRManifest | undefined = undefined;
  protected clientManifest: ClientManifest | undefined = undefined;

  /**
   * Load manifests on server start.
   */
  public readonly onStart = $hook({
    on: "start",
    handler: () => {
      if (this.alepha.isViteDev()) {
        // In dev mode, manifests don't exist
        return;
      }

      this.loadManifests();
    },
  });

  /**
   * Load both SSR and client manifests from disk.
   */
  protected loadManifests(): void {
    const distDir = join(process.cwd(), "dist/public");
    const ssrManifestPath = join(distDir, ".vite/ssr-manifest.json");
    const clientManifestPath = join(distDir, ".vite/manifest.json");

    // Load SSR manifest
    if (existsSync(ssrManifestPath)) {
      try {
        const content = readFileSync(ssrManifestPath, "utf-8");
        this.ssrManifest = JSON.parse(content);
        this.log.debug("SSR manifest loaded", {
          entries: Object.keys(this.ssrManifest ?? {}).length,
        });
      } catch (error) {
        this.log.warn("Failed to load SSR manifest", { error });
      }
    } else {
      this.log.trace("SSR manifest not found", { path: ssrManifestPath });
    }

    // Load client manifest
    if (existsSync(clientManifestPath)) {
      try {
        const content = readFileSync(clientManifestPath, "utf-8");
        this.clientManifest = JSON.parse(content);
        this.log.debug("Client manifest loaded", {
          entries: Object.keys(this.clientManifest ?? {}).length,
        });
      } catch (error) {
        this.log.warn("Failed to load client manifest", { error });
      }
    }
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
      chunks.add("/" + entry.file);
    }

    // Add CSS files
    if (entry.css) {
      for (const css of entry.css) {
        chunks.add("/" + css);
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
   * Get modulepreload links for a source file.
   *
   * @param sourcePath - Source file path
   * @returns Array of objects with rel and href for link tags
   */
  public getPreloadLinks(
    sourcePath: string,
  ): Array<{ rel: string; href: string; as?: string; crossorigin?: string }> {
    const chunks = this.getChunks(sourcePath);

    return chunks.map((href) => {
      // Determine if it's JS or CSS
      if (href.endsWith(".css")) {
        return {
          rel: "preload",
          href,
          as: "style",
        };
      }

      return {
        rel: "modulepreload",
        href,
      };
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
}
