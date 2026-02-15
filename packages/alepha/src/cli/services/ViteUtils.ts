import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { $hook, $inject, type Alepha, AlephaError } from "alepha";
import { FileSystemProvider } from "alepha/system";
import type { InlineConfig, Logger, Plugin, ViteDevServer } from "vite";
import type { AppEntry } from "../providers/AppEntryProvider.ts";

// -----------------------------------------------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------------------------------------------

interface BufferedLogEntry {
  level: "info" | "warn" | "error";
  msg: string;
  timestamp: Date;
}

export interface BufferedLogger extends Logger {
  /**
   * Flush all buffered log messages to console.
   * Call this on build failure to show what happened.
   */
  flush(): void;

  /**
   * Get all buffered log entries.
   */
  getEntries(): BufferedLogEntry[];

  /**
   * Clear all buffered entries without printing.
   */
  clear(): void;
}

/**
 * Preload manifest mapping short keys to source paths.
 * Generated at build time, consumed by SSRManifestProvider at runtime.
 */
export interface PreloadManifest {
  [key: string]: string;
}

// -----------------------------------------------------------------------------------------------------------------
// ViteUtils
// -----------------------------------------------------------------------------------------------------------------

/**
 * Vite integration utilities for the Alepha CLI.
 *
 * Centralizes all Vite-specific code: lazy loading, plugin creation,
 * buffered logger, dev server management.
 * When Vite is replaced, only this file needs to change.
 */
export class ViteUtils {
  protected readonly fs = $inject(FileSystemProvider);
  protected viteDevServer?: ViteDevServer;

  // ---------------------------------------------------------------------------------------------------------------
  // Vite loaders
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Lazy-load Vite (with rolldown-vite fallback).
   */
  public async importVite(): Promise<typeof import("vite")> {
    try {
      return createRequire(import.meta.url)("rolldown-vite");
    } catch {
      try {
        return createRequire(import.meta.url)("vite");
      } catch {
        throw new AlephaError(
          "Vite is not installed. Please install it with `npm install vite`.",
        );
      }
    }
  }

  /**
   * Lazy-load @vitejs/plugin-react (optional).
   */
  public async importViteReact(): Promise<any> {
    try {
      const { default: viteReact } = createRequire(import.meta.url)(
        "@vitejs/plugin-react",
      );
      return viteReact;
    } catch {
      // @vitejs/plugin-react not installed, skip
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Buffered logger
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Create a Vite logger that buffers all messages instead of printing them.
   * Useful for silent builds that only show output on failure.
   */
  public createBufferedLogger(): BufferedLogger {
    const entries: BufferedLogEntry[] = [];
    const loggedErrors = new WeakSet<Error>();
    const warnedMessages = new Set<string>();
    let hasWarned = false;

    const logger: BufferedLogger = {
      get hasWarned() {
        return hasWarned;
      },

      info(msg: string) {
        entries.push({ level: "info", msg, timestamp: new Date() });
      },

      warn(msg: string) {
        hasWarned = true;
        entries.push({ level: "warn", msg, timestamp: new Date() });
      },

      warnOnce(msg: string) {
        if (warnedMessages.has(msg)) {
          return;
        }
        warnedMessages.add(msg);
        hasWarned = true;
        entries.push({ level: "warn", msg, timestamp: new Date() });
      },

      error(msg: string, options?: { error?: Error | null }) {
        if (options?.error) {
          loggedErrors.add(options.error);
        }
        entries.push({ level: "error", msg, timestamp: new Date() });
      },

      clearScreen() {
        // No-op in buffered mode
      },

      hasErrorLogged(error: Error): boolean {
        return loggedErrors.has(error);
      },

      flush() {
        for (const entry of entries) {
          const prefix =
            entry.level === "error"
              ? "\x1b[31m✖\x1b[0m"
              : entry.level === "warn"
                ? "\x1b[33m⚠\x1b[0m"
                : "\x1b[36mℹ\x1b[0m";
          console.log(`${prefix} ${entry.msg}`);
        }
      },

      getEntries() {
        return [...entries];
      },

      clear() {
        entries.length = 0;
        warnedMessages.clear();
        hasWarned = false;
      },
    };

    return logger;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // SSR preload plugin
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Vite plugin that generates a preload manifest for SSR module preloading.
   *
   * Collects lazy import paths from $page definitions during transform,
   * generates a manifest mapping short keys to resolved source paths,
   * and injects only the short key into $page definitions.
   */
  public createSsrPreloadPlugin(): Plugin {
    let root = "";
    const preloadMap = new Map<string, string>();

    function generateKey(sourcePath: string): string {
      return createHash("md5").update(sourcePath).digest("hex").slice(0, 8);
    }

    return {
      name: "alepha-preload",
      configResolved(config) {
        root = config.root;
      },
      transform(code, id) {
        if (!id.match(/\.[tj]sx?$/)) return null;
        if (id.includes("node_modules")) return null;
        if (!code.includes("$page") || !code.includes("lazy")) return null;

        const insertions: Array<{ position: number; text: string }> = [];
        const pageStartRegex = /\$page\s*\(\s*\{/g;
        let pageMatch: RegExpExecArray | null = pageStartRegex.exec(code);

        while (pageMatch !== null) {
          const objectStartIndex = pageMatch.index + pageMatch[0].length - 1;

          let braceCount = 1;
          let i = objectStartIndex + 1;
          while (i < code.length && braceCount > 0) {
            if (code[i] === "{") braceCount++;
            else if (code[i] === "}") braceCount--;
            i++;
          }

          if (braceCount !== 0) {
            pageMatch = pageStartRegex.exec(code);
            continue;
          }

          const objectEndIndex = i - 1;
          const pageContent = code.slice(objectStartIndex, objectEndIndex + 1);

          if (pageContent.includes("alepha.page.preload")) {
            pageMatch = pageStartRegex.exec(code);
            continue;
          }

          const lazyRegex =
            /lazy\s*:\s*\(\s*\)\s*=>\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)/;
          const lazyMatch = lazyRegex.exec(pageContent);

          if (!lazyMatch) {
            pageMatch = pageStartRegex.exec(code);
            continue;
          }

          const importPath = lazyMatch[1];
          const currentDir = dirname(id);
          let resolvedPath: string;

          if (importPath.startsWith(".")) {
            resolvedPath = resolve(currentDir, importPath);
          } else if (importPath.startsWith("/")) {
            resolvedPath = resolve(root, importPath.slice(1));
          } else {
            pageMatch = pageStartRegex.exec(code);
            continue;
          }

          let relativePath = relative(root, resolvedPath);
          relativePath = relativePath.replace(/\\/g, "/");

          if (!relativePath.match(/\.[tj]sx?$/)) {
            relativePath = `${relativePath}.tsx`;
          } else if (relativePath.endsWith(".jsx")) {
            relativePath = relativePath.replace(/\.jsx$/, ".tsx");
          } else if (relativePath.endsWith(".js")) {
            relativePath = relativePath.replace(/\.js$/, ".ts");
          }

          const key = generateKey(relativePath);
          preloadMap.set(key, relativePath);

          const beforeBrace = code.slice(0, objectEndIndex).trimEnd();
          const needsComma = !beforeBrace.endsWith(",");
          const preloadProperty = `${needsComma ? "," : ""} [Symbol.for("alepha.page.preload")]: "${key}"`;

          insertions.push({ position: objectEndIndex, text: preloadProperty });
          pageMatch = pageStartRegex.exec(code);
        }

        if (insertions.length === 0) return null;

        let result = code;
        for (let j = insertions.length - 1; j >= 0; j--) {
          const { position, text } = insertions[j];
          result = result.slice(0, position) + text + result.slice(position);
        }

        return { code: result, map: null };
      },
      writeBundle(options) {
        const outDir = options.dir || "";
        if (outDir.includes("server")) return;

        if (preloadMap.size > 0) {
          const viteDir = join(outDir, ".vite");
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

  // ---------------------------------------------------------------------------------------------------------------
  // HTML template
  // ---------------------------------------------------------------------------------------------------------------

  public generateIndexHtml(entry: AppEntry): string {
    const style = entry.style;
    const browser = entry.browser ?? entry.server;
    return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>App</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
${style ? `<link rel="stylesheet" href="/${style}" />` : ""}
</head>
<body>
<div id="root"></div>
<script type="module" src="/${browser}"></script>
</body>
</html>
`.trim();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Dev server management
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * We need to close the Vite dev server after build is done.
   */
  protected onReady = $hook({
    on: "ready",
    priority: "last",
    handler: async () => {
      await this.viteDevServer?.close();
    },
  });

  protected onStop = $hook({
    on: "stop",
    handler: async () => {
      await this.viteDevServer?.close();
    },
  });

  public importModule(path: string): Promise<any> {
    if (!this.viteDevServer) {
      throw new AlephaError("Vite dev server not initialized");
    }
    return this.viteDevServer.ssrLoadModule(path);
  }

  public async runAlepha(opts: {
    entry: AppEntry;
    mode: "production" | "development";
  }): Promise<Alepha> {
    const { createServer } = await this.importVite();

    process.env.NODE_ENV = opts.mode;
    process.env.ALEPHA_CLI_IMPORT = "true"; // signal Alepha App about CLI import, run(alepha) won't start server
    process.env.LOG_LEVEL ??= "warn"; // reduce log noise

    /**
     * 01/26 Vite 7
     * "runnerImport" doesn't work as expected here. (e.g. build docs fail)
     * -> We still use devServer and ssrLoadModule for now.
     * -> This is clearly a bad stuff, we need to find better way.
     */
    this.viteDevServer = await createServer({
      server: { middlewareMode: true },
      appType: "custom",
      logLevel: "silent",
    } satisfies InlineConfig);

    await this.viteDevServer.ssrLoadModule(opts.entry.server);

    const alepha: Alepha = (globalThis as any).__alepha;
    if (!alepha) {
      throw new AlephaError(
        "Alepha instance not found after loading entry module",
      );
    }

    return alepha;
  }
}
