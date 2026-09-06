import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join, relative, resolve } from "node:path";

import { $hook, $inject, type Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import MagicString from "magic-string";
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

/**
 * The slice of the Rollup/rolldown plugin context the preload transform needs.
 *
 * Both of these are answers only the bundler can give: its own parser, and its
 * own resolver. Taking them as an argument is what lets the transform be
 * exercised without a build.
 */
export interface SsrPreloadContext {
  parse: (code: string, options?: unknown) => any;
  resolve: (
    source: string,
    importer: string,
  ) => Promise<{ id: string } | null | undefined>;
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
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly log = $logger();
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
   * Lazy-load vite-bundle-analyzer.
   *
   * Required at call time rather than imported at module scope for the same
   * reason as Vite itself, plus one of its own: the analyzer is reached only
   * under `--stats`, but a static import put its ~100 kB of report template
   * into anything that pulls the CLI barrel in — including `create-alepha`,
   * which bundles this module to scaffold projects and never builds one.
   */
  public async importAnalyzer(): Promise<
    typeof import("vite-bundle-analyzer").analyzer
  > {
    try {
      const { analyzer } = createRequire(import.meta.url)(
        "vite-bundle-analyzer",
      );
      return analyzer;
    } catch {
      throw new AlephaError(
        "vite-bundle-analyzer is not installed. It ships with `alepha`; reinstall your dependencies to run a build with `--stats`.",
      );
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
    // Captured once so the closures below do not reach for `this`.
    const now = () => this.dateTime.now().toDate();
    const entries: BufferedLogEntry[] = [];
    const loggedErrors = new WeakSet<Error>();
    const warnedMessages = new Set<string>();
    let hasWarned = false;

    const logger: BufferedLogger = {
      get hasWarned() {
        return hasWarned;
      },

      info(msg: string) {
        entries.push({ level: "info", msg, timestamp: now() });
      },

      warn(msg: string) {
        hasWarned = true;
        entries.push({ level: "warn", msg, timestamp: now() });
      },

      warnOnce(msg: string) {
        if (warnedMessages.has(msg)) {
          return;
        }
        warnedMessages.add(msg);
        hasWarned = true;
        entries.push({ level: "warn", msg, timestamp: now() });
      },

      error(msg: string, options?: { error?: Error | null }) {
        if (options?.error) {
          loggedErrors.add(options.error);
        }
        entries.push({ level: "error", msg, timestamp: now() });
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
  // TSConfig paths plugin
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Vite plugin that reads tsconfig.json `compilerOptions.paths` and converts
   * them to Vite `resolve.alias` entries. Enables `@/*` → `src/*` style imports
   * with zero config beyond tsconfig.json.
   */
  public createTsconfigPathsPlugin(): Plugin {
    return {
      name: "alepha-tsconfig-paths",
      async config(config) {
        const root = config.root || process.cwd();
        const tsconfigPath = join(root, "tsconfig.json");

        let content: string;
        try {
          content = await readFile(tsconfigPath, "utf-8");
        } catch {
          return;
        }

        // Strip JSONC comments before parsing
        const clean = content
          .replace(/\/\/.*$/gm, "")
          .replace(/\/\*[\s\S]*?\*\//g, "");

        let tsconfig: any;
        try {
          tsconfig = JSON.parse(clean);
        } catch {
          return;
        }

        const paths = tsconfig?.compilerOptions?.paths;
        if (!paths || typeof paths !== "object") return;

        const alias: Record<string, string> = {};
        for (const [pattern, targets] of Object.entries(paths)) {
          if (!Array.isArray(targets) || targets.length === 0) continue;
          const target = targets[0] as string;
          const aliasKey = pattern.replace(/\*$/, "");
          const aliasPath = target.replace(/\*$/, "").replace(/^\.\//, "");
          const resolved = resolve(root, aliasPath);
          alias[aliasKey] = aliasKey.endsWith("/") ? `${resolved}/` : resolved;
        }

        if (Object.keys(alias).length === 0) return;
        return { resolve: { alias } };
      },
    };
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

    // An arrow, so the transform hook below keeps `this` bound to the plugin
    // context while still reaching this service.
    const inject = (context: SsrPreloadContext, code: string, id: string) =>
      this.injectPreloadKeys(context, code, id, root, preloadMap);

    return {
      name: "alepha-preload",
      configResolved(config) {
        root = config.root;
      },
      transform(code, id) {
        return inject(this as unknown as SsrPreloadContext, code, id);
      },
      writeBundle(options) {
        const outDir = options.dir || "";
        // `dir` is the absolute outDir: test its last segment only, or any
        // checkout whose path contains "server" silently skipped the manifest.
        if (basename(outDir) === "server") return;

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

  /**
   * Register every `$page` of a module in the preload manifest and inject its
   * key, or return null when the module defines no lazily loaded page.
   */
  protected async injectPreloadKeys(
    context: SsrPreloadContext,
    code: string,
    id: string,
    root: string,
    preloadMap: Map<string, string>,
  ): Promise<{ code: string; map: any } | null> {
    if (!id.match(/\.[tj]sx?$/)) return null;
    if (id.includes("node_modules")) return null;
    if (!code.includes("$page") || !code.includes("lazy")) return null;

    let ast: any;
    try {
      ast = context.parse(code, this.parserOptionsFor(id));
    } catch {
      // Not this plugin's error to report: whatever cannot be parsed here
      // fails the build a moment later, with a real code frame.
      return null;
    }

    const magic = new MagicString(code);
    let injected = false;

    for (const page of this.findPageObjects(ast)) {
      if (this.hasPreloadKey(page)) continue;

      const importPath = this.readLazyImport(page);
      if (!importPath) continue;

      // Ask the resolver rather than guessing an extension: the guess is what
      // left every `.js` or `.jsx` application with no page preloads at all,
      // and it registered keys for files that do not exist.
      const resolved = await context.resolve(importPath, id);
      if (!resolved?.id) continue;

      const relativePath = relative(root, resolved.id.split("?")[0]).replace(
        /\\/g,
        "/",
      );

      const key = this.preloadKey(relativePath);
      preloadMap.set(key, relativePath);

      // After the last property, never before the closing brace: the object
      // may already carry a trailing comma, and a comma is legal in both
      // spellings here.
      const properties = page.properties;
      const anchor = properties[properties.length - 1].end;
      magic.appendLeft(
        anchor,
        `, [Symbol.for("alepha.page.preload")]: "${key}"`,
      );
      injected = true;
    }

    if (!injected) return null;

    return {
      code: magic.toString(),
      map: magic.generateMap({ source: id, hires: true }),
    };
  }

  /**
   * Short, stable key for a source path. The full path lives in the preload
   * manifest; only this key is injected into the bundle.
   */
  public preloadKey(sourcePath: string): string {
    return createHash("md5").update(sourcePath).digest("hex").slice(0, 8);
  }

  /**
   * Parser options for a module, so `this.parse` reads the file under the
   * dialect it is actually written in.
   */
  protected parserOptionsFor(id: string): {
    lang: "js" | "jsx" | "ts" | "tsx";
    astType: "js" | "ts";
  } {
    const lang = id.endsWith(".tsx")
      ? "tsx"
      : id.endsWith(".ts")
        ? "ts"
        : id.endsWith(".jsx")
          ? "jsx"
          : "js";
    return { lang, astType: lang.startsWith("ts") ? "ts" : "js" };
  }

  /**
   * Every object literal passed as the first argument of a `$page(...)` call.
   *
   * Walking the AST rather than scanning the text is what makes comments and
   * string literals cost nothing: neither is a node, so a `$page` in an
   * `@example` block is invisible and a `}` inside a string cannot move the
   * end of the object.
   */
  protected findPageObjects(node: any, found: any[] = []): any[] {
    if (!node || typeof node !== "object") return found;

    if (Array.isArray(node)) {
      for (const child of node) this.findPageObjects(child, found);
      return found;
    }

    if (typeof node.type !== "string") return found;

    if (
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      node.callee.name === "$page" &&
      node.arguments?.[0]?.type === "ObjectExpression" &&
      node.arguments[0].properties?.length > 0
    ) {
      found.push(node.arguments[0]);
    }

    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end") continue;
      this.findPageObjects(node[key], found);
    }

    return found;
  }

  /**
   * The module specifier of `lazy: () => import("...")`, when the page has one.
   */
  protected readLazyImport(page: any): string | undefined {
    for (const property of page.properties ?? []) {
      if (property.type !== "Property" || property.computed) continue;

      const name =
        property.key?.type === "Identifier"
          ? property.key.name
          : property.key?.value;
      if (name !== "lazy") continue;

      const body = property.value?.body;
      if (body?.type !== "ImportExpression") continue;
      if (typeof body.source?.value !== "string") continue;

      return body.source.value;
    }

    return undefined;
  }

  /**
   * Whether the page already carries an injected preload key, so a second
   * pass over the same module cannot inject a duplicate.
   */
  protected hasPreloadKey(page: any): boolean {
    return (page.properties ?? []).some(
      (property: any) =>
        property.computed &&
        property.key?.type === "CallExpression" &&
        property.key.arguments?.[0]?.value === "alepha.page.preload",
    );
  }

  // ---------------------------------------------------------------------------------------------------------------
  // HTML template
  // ---------------------------------------------------------------------------------------------------------------

  public generateIndexHtml(entry: AppEntry, opts?: { pwa?: boolean }): string {
    const style = entry.style;
    const browser = entry.browser ?? entry.server;
    const manifestLink = opts?.pwa
      ? '\n<link rel="manifest" href="/manifest.webmanifest" />'
      : "";
    return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>App</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>${manifestLink}
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

  public async runAlepha(opts: {
    entry: AppEntry;
    mode: "production" | "development";
  }): Promise<Alepha> {
    const { createServer } = await this.importVite();

    process.env.NODE_ENV = opts.mode;
    process.env.ALEPHA_CLI_IMPORT = "true"; // signal Alepha App about CLI import, run(alepha) won't start server
    process.env.LOG_LEVEL ??= "warn"; // reduce log noise
    process.env.APP_SECRET ??= "123456"; // avoid warning about missing secret, not used in CLI context

    /**
     * 01/26 Vite 7
     * "runnerImport" doesn't work as expected here. (e.g. build docs fail)
     * -> We still use devServer and ssrLoadModule for now.
     * -> This is clearly a bad stuff, we need to find better way.
     */
    // A second `runAlepha` used to overwrite this field and leak the first
    // server (and its file watchers) for the life of the process.
    await this.viteDevServer?.close().catch((error) => {
      this.log.warn("Failed to close the previous Vite dev server", error);
    });

    this.viteDevServer = await createServer({
      server: { middlewareMode: true },
      appType: "custom",
      logLevel: "silent",
      plugins: [this.createTsconfigPathsPlugin()],
      // No client dependency optimizer. This server only ever serves
      // `ssrLoadModule`, yet Vite still created one for the client
      // environment: with no entries it scanned nothing, and on crawl end it
      // committed an EMPTY pre-bundle into the app's `node_modules/.vite/deps`,
      // the same directory a running `alepha dev` on that app serves its
      // pre-bundled dependencies from. The commit renames the live directory
      // away and deletes it, so every dependency the browser had not loaded
      // yet answered `504 Outdated Optimize Dep` until the dev server was
      // restarted. Every `alepha build`, `gen env` or `db …` did it, which is
      // how `yarn v` in one terminal broke `yarn dev` in another. `noDiscovery`
      // with an empty `include` is Vite's switch for "no optimizer at all":
      // the environment is created without one and never touches the cache.
      optimizeDeps: { noDiscovery: true, include: [] },
    } satisfies InlineConfig);

    await this.viteDevServer.ssrLoadModule(opts.entry.server);

    delete process.env.ALEPHA_CLI_IMPORT;

    const alepha: Alepha = (globalThis as any).__alepha;
    if (!alepha) {
      throw new AlephaError(
        "Alepha instance not found after loading entry module",
      );
    }

    return alepha;
  }

  /**
   * Import a module through the same graph the app was loaded from.
   *
   * A plain `import()` here resolves against the CLI's own module graph, which
   * produces a *different* object for the same source file than the app's
   * Vite SSR graph. Registering that object into the app's container gives it
   * a second, parallel copy of every service in the module — the duplicate
   * that {@link OpenApiCommand} documents. Going back through
   * `ssrLoadModule` keeps class identity consistent with the container we are
   * about to mutate.
   *
   * Only valid after {@link runAlepha}, which is what creates the server.
   */
  public async importFromAppGraph<T = any>(specifier: string): Promise<T> {
    if (!this.viteDevServer) {
      throw new AlephaError(
        `Cannot import '${specifier}': the app has not been loaded yet.`,
      );
    }

    return (await this.viteDevServer.ssrLoadModule(specifier)) as T;
  }
}
