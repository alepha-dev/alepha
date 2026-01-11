import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * Preload manifest mapping short keys to source paths.
 * Generated at build time, consumed by SSRManifestProvider at runtime.
 */
export interface PreloadManifest {
  [key: string]: string;
}

/**
 * Vite plugin that generates a preload manifest for SSR module preloading.
 *
 * Instead of injecting source paths directly into $page definitions (which would
 * leak component paths in the browser bundle), this plugin:
 *
 * 1. Collects all lazy import paths from $page definitions during transform
 * 2. Generates a manifest file mapping short keys to resolved source paths
 * 3. Injects only the short key into $page definitions
 *
 * The manifest is written to `.vite/preload-manifest.json` alongside Vite's
 * other manifests. The CLI build command moves all manifests to
 * `dist/server/.ssr/` where SSRManifestProvider loads them at runtime.
 *
 * Before:
 * ```typescript
 * $page({
 *   path: '/users/:id',
 *   lazy: () => import('./UserDetail.tsx'),
 * })
 * ```
 *
 * After:
 * ```typescript
 * $page({
 *   path: '/users/:id',
 *   lazy: () => import('./UserDetail.tsx'),
 *   [Symbol.for("alepha.page.preload")]: "a1b2c3",
 * })
 * ```
 *
 * Manifest (.alepha/preload-manifest.json):
 * ```json
 * {
 *   "a1b2c3": "src/pages/UserDetail.tsx"
 * }
 * ```
 */
export function viteAlephaSsrPreload(): Plugin {
  let root = "";
  const preloadMap = new Map<string, string>(); // key -> sourcePath

  /**
   * Generate a short hash key for a source path.
   * Uses first 8 chars of MD5 hash for brevity while avoiding collisions.
   */
  function generateKey(sourcePath: string): string {
    return createHash("md5").update(sourcePath).digest("hex").slice(0, 8);
  }

  return {
    name: "alepha-preload",
    configResolved(config) {
      root = config.root;
    },
    transform(code, id) {
      // Only process TypeScript/JavaScript files
      if (!id.match(/\.[tj]sx?$/)) {
        return null;
      }

      // Skip node_modules
      if (id.includes("node_modules")) {
        return null;
      }

      // Quick check if file contains $page with lazy
      if (!code.includes("$page") || !code.includes("lazy")) {
        return null;
      }

      // Collect all insertions first, then apply in reverse order
      const insertions: Array<{ position: number; text: string }> = [];

      // Find all $page({ occurrences
      const pageStartRegex = /\$page\s*\(\s*\{/g;
      let pageMatch: RegExpExecArray | null = pageStartRegex.exec(code);

      while (pageMatch !== null) {
        const startIndex = pageMatch.index;
        const objectStartIndex = startIndex + pageMatch[0].length - 1; // Position of '{'

        // Find the matching closing brace using brace counting
        let braceCount = 1;
        let i = objectStartIndex + 1;
        while (i < code.length && braceCount > 0) {
          if (code[i] === "{") braceCount++;
          else if (code[i] === "}") braceCount--;
          i++;
        }

        // Malformed, skip
        if (braceCount !== 0) {
          pageMatch = pageStartRegex.exec(code);
          continue;
        }

        const objectEndIndex = i - 1; // Position of matching '}'
        const pageContent = code.slice(objectStartIndex, objectEndIndex + 1);

        // Skip if already has preload symbol
        if (pageContent.includes("alepha.page.preload")) {
          pageMatch = pageStartRegex.exec(code);
          continue;
        }

        // Find lazy: () => import('...') within this $page block
        const lazyRegex =
          /lazy\s*:\s*\(\s*\)\s*=>\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)/;
        const lazyMatch = lazyRegex.exec(pageContent);

        if (!lazyMatch) {
          pageMatch = pageStartRegex.exec(code);
          continue;
        }

        const importPath = lazyMatch[1];

        // Resolve the import path relative to the current file
        const currentDir = dirname(id);
        let resolvedPath: string;

        if (importPath.startsWith(".")) {
          // Relative import
          resolvedPath = resolve(currentDir, importPath);
        } else if (importPath.startsWith("/")) {
          // Absolute import from root
          resolvedPath = resolve(root, importPath.slice(1));
        } else {
          // Package import - skip preloading for external packages
          pageMatch = pageStartRegex.exec(code);
          continue;
        }

        // Make path relative to root for SSR manifest lookup
        let relativePath = relative(root, resolvedPath);

        // Normalize path separators for cross-platform compatibility
        relativePath = relativePath.replace(/\\/g, "/");

        // Handle extension - Vite resolves .jsx imports to .tsx files
        // Try to use .tsx when the source has .jsx since TypeScript is more common
        if (!relativePath.match(/\.[tj]sx?$/)) {
          relativePath = `${relativePath}.tsx`;
        } else if (relativePath.endsWith(".jsx")) {
          // Import said .jsx but actual file is likely .tsx
          relativePath = relativePath.replace(/\.jsx$/, ".tsx");
        } else if (relativePath.endsWith(".js")) {
          // Import said .js but actual file is likely .ts
          relativePath = relativePath.replace(/\.js$/, ".ts");
        }

        // Generate short key and store mapping
        const key = generateKey(relativePath);
        preloadMap.set(key, relativePath);

        // Check if we need a comma (look at character before closing brace)
        const beforeBrace = code.slice(0, objectEndIndex).trimEnd();
        const needsComma = !beforeBrace.endsWith(",");
        // Use Symbol.for() so it can be looked up at runtime without importing
        // Only inject the short key, not the full path
        const preloadProperty = `${needsComma ? "," : ""} [Symbol.for("alepha.page.preload")]: "${key}"`;

        insertions.push({ position: objectEndIndex, text: preloadProperty });

        pageMatch = pageStartRegex.exec(code);
      }

      if (insertions.length === 0) {
        return null;
      }

      // Apply insertions in reverse order to preserve positions
      let result = code;
      for (let j = insertions.length - 1; j >= 0; j--) {
        const { position, text } = insertions[j];
        result = result.slice(0, position) + text + result.slice(position);
      }

      return {
        code: result,
        map: null,
      };
    },
    writeBundle(options) {
      // Only process client build (outputs to dist/public or similar)
      // Skip server build which outputs to dist/server
      const outDir = options.dir || "";
      if (outDir.includes("server")) {
        return;
      }

      // Write the preload manifest to the same .vite directory Vite uses
      // The CLI build command will move all manifests to dist/server/.ssr/
      if (preloadMap.size > 0) {
        const viteDir = join(outDir, ".vite");

        // Ensure .vite directory exists
        if (!existsSync(viteDir)) {
          mkdirSync(viteDir, { recursive: true });
        }

        const manifest: PreloadManifest = Object.fromEntries(preloadMap);
        const manifestPath = join(viteDir, "preload-manifest.json");
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      }
    },
  };
}
