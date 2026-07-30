import { createRequire } from "node:module";
import { isAbsolute, join } from "node:path";
import { $inject, Alepha, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import type * as vite from "vite";
import type { UserConfig } from "vite";
import { analyzer as viteAnalyzer } from "vite-bundle-analyzer";
import { ViteUtils } from "../services/ViteUtils.ts";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

/**
 * Build server-side SSR bundle with Vite.
 *
 * Compiles the server code for production, generates the externals
 * package.json, and creates the dist/index.js entry wrapper.
 */
export class BuildServerTask extends BuildTask {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly viteUtils = $inject(ViteUtils);

  /**
   * Whether the Durable Object class should be re-exported through the app's
   * server bundle. Set to `true` only for a `workerd` build of an app that uses
   * the `$websocket` primitive. Any other build leaves this `false`, so the
   * generated bundle and `dist/index.js` stay byte-identical to before.
   */
  protected exportDurableObject = false;

  async run(ctx: BuildTaskContext): Promise<void> {
    if (ctx.flags?.prebuilt) {
      return;
    }
    const distDir = ctx.options.output?.dist ?? "dist";
    const publicDir = ctx.options.output?.public ?? "public";
    const stats = ctx.options.stats ?? false;
    const isCI = this.alepha.isCI();

    const clientIndexPath = this.fs.join(
      ctx.root,
      distDir,
      publicDir,
      "index.html",
    );
    const clientBuilt = await this.fs.exists(clientIndexPath);

    const conditions: string[] = [];
    if (ctx.options.runtime === "bun") {
      conditions.push("bun");
    } else if (ctx.options.runtime === "workerd") {
      conditions.push("workerd");
    }

    await ctx.run({
      name: "build server",
      handler: async () => {
        await this.buildServer({
          root: ctx.root,
          entry: ctx.entry.server,
          distDir,
          clientDir: clientBuilt ? publicDir : undefined,
          stats,
          silent: !isCI,
          conditions,
          alepha: ctx.alepha,
        });

        // Server will handle index.html if both client & server are built
        if (clientBuilt) {
          await this.fs.rm(clientIndexPath);
        }
      },
    });
  }

  protected async buildServer(opts: {
    root: string;
    entry: string;
    distDir: string;
    clientDir?: string;
    stats?: boolean | "json";
    silent?: boolean;
    conditions?: string[];
    alepha: Alepha;
  }): Promise<void> {
    const { build: viteBuild, resolveConfig } =
      await this.viteUtils.importVite();
    const plugins: any[] = [];

    const viteReact = await this.viteUtils.importViteReact();
    if (viteReact && opts.clientDir) {
      plugins.push(viteReact());
    }

    plugins.push(this.viteUtils.createTsconfigPathsPlugin());
    plugins.push(this.viteUtils.createSsrPreloadPlugin());

    if (opts.conditions?.includes("workerd")) {
      plugins.push(this.workerdCreateRequirePlugin());
    }

    if (opts.stats) {
      plugins.push(
        viteAnalyzer({
          analyzerMode: opts.stats === "json" ? "json" : "static",
        }),
      );
    }

    const logger = opts.silent
      ? this.viteUtils.createBufferedLogger()
      : undefined;

    const conditions = ["node", "import", "module", "default"];
    if (opts.conditions) {
      conditions.unshift(...opts.conditions);
    }

    // Cloudflare ships `dist/index.js` + `dist/server/*.js` under `no_bundle`
    // (no node_modules). For the `AlephaWebSocketDurableObject` class named in
    // the wrangler `durable_objects`/`migrations` config to be reachable at the
    // edge, it must ride out through the app's own server bundle as a real
    // named export. Only do this for a workerd build of an app that actually
    // uses `$websocket` or `$room` — every other build stays untouched.
    this.exportDurableObject =
      (opts.conditions?.includes("workerd") ?? false) &&
      this.usesWebSocket(opts.alepha);

    // For the entry chunk to carry the named export, build from a generated
    // entry that both runs the real app entry (for its side effects) and
    // re-exports the DO class. The same `entry` is passed to `build.ssr` and
    // to `extractEntryFromBundle`, so the facade chunk is found.
    let entry = opts.entry;
    if (this.exportDurableObject) {
      const entryAbsolute = isAbsolute(opts.entry)
        ? opts.entry
        : join(opts.root, opts.entry);
      const generated = `${opts.distDir}/.alepha-workerd-entry.mjs`;
      await this.fs.mkdir(opts.distDir);
      await this.fs.writeFile(
        generated,
        `import ${JSON.stringify(entryAbsolute)};\n` +
          `export { AlephaWebSocketDurableObject } from "alepha/websocket";\n`,
      );
      entry = generated;
    }

    const viteBuildServerConfig: UserConfig = {
      mode: "production",
      logLevel: opts.silent ? "silent" : undefined,
      define: {
        "process.env.NODE_ENV": '"production"',
      },
      resolve: {
        dedupe: [
          "react",
          "react-dom",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
        ],
      },
      publicDir: false,
      ssr: {
        noExternal: true,
        resolve: { conditions },
      },
      build: {
        ssr: entry,
        minify: true,
        sourcemap: true,
        chunkSizeWarningLimit: 10000,
        outDir: `${opts.distDir}/server`,
        rolldownOptions: {
          external: [/^bun(:|$)/, /^cloudflare:/],
          output: {
            entryFileNames: "[hash].js",
            chunkFileNames: "[hash].js",
            assetFileNames: "[hash][extname]",
            format: "esm",
            codeSplitting: {
              groups: [
                {
                  name: "react",
                  test: /node_modules\/react(\/|-dom\/)/,
                },
              ],
            },
            // Rolldown/Oxc minifier: preserve class and function names
            minify: {
              mangle: { keepNames: true },
              compress: {
                keepNames: { function: true, class: true },
              },
            },
          },
        },
      },
      customLogger: logger,
      plugins,
    };

    let result: vite.Rollup.RollupOutput | vite.Rollup.RollupOutput[];
    try {
      result = (await viteBuild(viteBuildServerConfig)) as
        | vite.Rollup.RollupOutput
        | vite.Rollup.RollupOutput[];
    } catch (error) {
      logger?.flush();
      throw error;
    }

    const resolvedConfig = await resolveConfig(viteBuildServerConfig, "build");

    const externals: string[] = [];
    if (Array.isArray(resolvedConfig?.ssr?.external)) {
      externals.push(...resolvedConfig.ssr.external);
    }

    await this.generateExternals(opts.distDir, externals);

    const entryFile = this.extractEntryFromBundle(opts.root, entry, result);

    let manifest = "";
    let manifestData:
      | {
          base?: string;
          client?: Record<string, any>;
          preload?: Record<string, string>;
          favicon?: string;
        }
      | undefined;

    if (opts.clientDir) {
      const viteDir = `${opts.distDir}/${opts.clientDir}/.vite`;
      const clientManifest = await this.loadJsonFile(
        `${viteDir}/manifest.json`,
      );
      const preloadManifest = await this.loadJsonFile(
        `${viteDir}/preload-manifest.json`,
      );

      const strippedClientManifest = this.stripClientManifest(clientManifest);

      let base = resolvedConfig.base || "/";
      if (!base.startsWith("/")) {
        base = `/${base}`;
      }
      if (base.length > 1 && base.endsWith("/")) {
        base = base.slice(0, -1);
      }

      const favicon = await this.detectFavicon(
        `${opts.distDir}/${opts.clientDir}`,
      );

      manifestData = {
        base: base !== "/" ? base : undefined,
        client: strippedClientManifest,
        preload: preloadManifest,
        favicon,
      };

      manifest = `__alepha.set("alepha.react.ssr.manifest", ${JSON.stringify(manifestData, null, "  ")});\n`;

      opts.alepha.store.set("alepha.react.ssr.manifest" as any, manifestData);

      await this.fs.rm(viteDir, { recursive: true });
    }

    const warning =
      "// This file was automatically generated. DO NOT MODIFY." +
      "\n" +
      "// Changes to this file will be lost when the code is regenerated.\n";

    await this.fs.writeFile(
      `${opts.distDir}/index.js`,
      `${warning}\nimport './server/${entryFile}';\n${this.durableObjectReexport(entryFile)}\n${manifest}`.trim(),
    );
  }

  /**
   * Re-export line appended to `dist/index.js` so the Durable Object class rides
   * out through the app's own (`no_bundle`) server bundle and is reachable from
   * the generated Cloudflare worker entry (`main.cloudflare.js` does
   * `export { AlephaWebSocketDurableObject } from "./index.js"`).
   *
   * Returns an empty string for any build that is not a workerd +
   * `$websocket`/`$room` build, keeping `dist/index.js` byte-identical to
   * before in every other case.
   */
  protected durableObjectReexport(entryFile: string): string {
    if (!this.exportDurableObject) {
      return "";
    }
    return `export { AlephaWebSocketDurableObject } from "./server/${entryFile}";\n`;
  }

  /**
   * Whether the workspace's realtime layer needs the Durable Object export:
   * true when it registers `$websocket` OR `$room` primitives. A rooms-only
   * app (no `$websocket` at all) still runs inside
   * `AlephaWebSocketDurableObject`, so it needs the exact same re-export.
   */
  protected usesWebSocket(alepha: Alepha): boolean {
    return (
      alepha.primitives("$websocket").length > 0 ||
      alepha.primitives("$room").length > 0
    );
  }

  /**
   * Output plugin for workerd builds that rewrites every
   * `createRequire(import.meta.url)` call in the emitted chunks into an inert
   * require factory (see {@link neutralizeWorkerdCreateRequire}).
   *
   * Rolldown injects that exact call as a top-of-chunk CJS-interop banner
   * whenever a bundled CommonJS module references `require` — and on
   * Cloudflare, `import.meta.url` is `undefined` during script validation, so
   * `createRequire(undefined)` throws before the worker ever runs
   * (`Uncaught TypeError: The argument 'path' must be a file URL…`, deploy
   * error 10021). The banner is injected at output time, after module
   * resolution, so a `resolveId`-level shim of `node:module` cannot catch it;
   * only a `renderChunk` rewrite can.
   *
   * The same undefined `import.meta.url` also breaks the standard Vite asset
   * idiom `new URL("./rel.png", import.meta.url)`, which Vite's SSR build
   * leaves untouched (it is valid on Node) — any module-scope occurrence in a
   * workerd chunk throws `Uncaught TypeError: Invalid URL string.` at
   * validation. After the createRequire calls are neutralized (their pattern
   * matches on the literal `import.meta.url` token, so order matters), every
   * remaining `import.meta.url` is stubbed with the chunk's own stable
   * `file:///` URL (see {@link stubWorkerdImportMetaUrl}).
   */
  protected workerdCreateRequirePlugin(): vite.Plugin {
    return {
      name: "alepha:workerd-create-require",
      renderChunk: (code: string, chunk: { fileName: string }) => {
        const rewritten = this.stubWorkerdImportMetaUrl(
          this.neutralizeWorkerdCreateRequire(code),
          chunk.fileName,
        );
        return rewritten === code ? null : { code: rewritten, map: null };
      },
    };
  }

  /**
   * Rewrite `createRequire(import.meta.url)` calls (under whatever local alias
   * the chunk imports `createRequire` from `node:module` as) into an inline
   * factory returning a require that throws only when actually CALLED.
   *
   * Both behaviours that exist in real bundles are preserved:
   * - the dead interop banner (`var r = createRequire(import.meta.url)` with
   *   zero call sites, e.g. pixi.js pulled into an SSR bundle) becomes
   *   harmless instead of throwing at startup/validation, and
   * - a lazy `createRequire(import.meta.url)(pkg)` inside a try/catch (e.g.
   *   drizzle-kit's optional import) still reaches its catch with a clear
   *   error, exactly as it would on a runtime with no node_modules.
   *
   * The import itself is left in place: `nodejs_compat` provides
   * `node:module` at link time, so only the eager call is the problem.
   */
  protected neutralizeWorkerdCreateRequire(code: string): string {
    const aliases = new Set<string>();
    const importPattern =
      /import\s*\{([^}]*)\}\s*from\s*["'`]node:module["'`]/g;
    for (const match of code.matchAll(importPattern)) {
      for (const specifier of match[1].split(",")) {
        const [imported, local] = specifier
          .split(/\s+as\s+/)
          .map((part) => part.trim());
        if (imported === "createRequire") {
          aliases.add(local ?? imported);
        }
      }
    }

    const inertFactory =
      `(()=>{const r=(id)=>{` +
      `throw new Error("createRequire is unavailable on workerd; cannot require "+JSON.stringify(id))` +
      `};r.resolve=r;return r})()`;

    let output = code;
    for (const alias of aliases) {
      const escaped = alias.replace(/[$\\]/g, "\\$&");
      // Manual left boundary: `\b` misbehaves when the alias starts with `$`.
      const callPattern = new RegExp(
        `(^|[^\\w$.])${escaped}\\(import\\.meta\\.url\\)`,
        "g",
      );
      output = output.replace(callPattern, `$1${inertFactory}`);
    }
    return output;
  }

  /**
   * Replace every remaining `import.meta.url` token in a workerd chunk with
   * the chunk's own stable `file:///server/<fileName>` URL string.
   *
   * On Cloudflare, `import.meta.url` is `undefined` during deploy-time script
   * validation (and stays useless at runtime), so any module-scope
   * `new URL(rel, import.meta.url)` — the standard Vite asset idiom, which
   * the SSR build deliberately leaves untouched — kills the upload with
   * `Invalid URL string.` (error 10021). Stubbing in the chunk's own module
   * URL keeps the closest possible Node semantics: relative asset paths
   * resolve to deterministic (if fictional) `file:///` URLs instead of
   * throwing, which is all a browser-only module dragged into the server
   * bundle by a `$page` tree needs.
   *
   * Runs AFTER {@link neutralizeWorkerdCreateRequire}: that rewrite matches
   * on the literal `import.meta.url` token inside the createRequire call.
   */
  protected stubWorkerdImportMetaUrl(code: string, fileName: string): string {
    const stub = JSON.stringify(`file:///server/${fileName}`);
    return code.replace(/import\.meta\.url\b/g, stub);
  }

  /**
   * Detect a favicon file in the given directory.
   * Returns "mimeType:/path" if found, undefined otherwise.
   */
  protected async detectFavicon(
    publicDir: string,
  ): Promise<string | undefined> {
    const candidates: [string, string][] = [
      ["favicon.svg", "image/svg+xml"],
      ["favicon.png", "image/png"],
      ["favicon.ico", "image/x-icon"],
    ];
    for (const [file, mime] of candidates) {
      if (await this.fs.exists(join(publicDir, file))) {
        return `${mime}:/${file}`;
      }
    }
    return undefined;
  }

  protected async generateExternals(
    distDir: string,
    externals: string[],
  ): Promise<void> {
    const require = createRequire(import.meta.filename);
    const deps: Record<string, string> = {};

    for (const dep of externals) {
      try {
        const requirePath = require.resolve(dep);
        const pkgPath = `${requirePath.split(`node_modules/${dep}`)[0]}node_modules/${dep}/package.json`;
        const pkg = JSON.parse((await this.fs.readFile(pkgPath)).toString());
        deps[dep] = `^${pkg.version}`;
      } catch {
        this.log.warn(`Cannot find '${dep}' in node_modules`);
      }
    }

    const minimalPkg = {
      type: "module",
      main: "index.js",
      dependencies: deps,
    };

    await this.fs.mkdir(distDir);
    await this.fs.writeFile(
      join(distDir, "package.json"),
      JSON.stringify(minimalPkg, null, 2),
    );
  }

  protected async loadJsonFile(path: string): Promise<any> {
    try {
      const content = (await this.fs.readFile(path)).toString();
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }

  protected stripClientManifest(
    manifest: Record<string, any> | undefined,
  ): Record<string, any> | undefined {
    if (!manifest) return undefined;

    const stripped: Record<string, any> = {};
    for (const [key, entry] of Object.entries(manifest)) {
      stripped[key] = {
        file: entry.file,
        ...(entry.isEntry && { isEntry: entry.isEntry }),
        ...(entry.imports?.length && { imports: entry.imports }),
        ...(entry.css?.length && { css: entry.css }),
      };
    }
    return stripped;
  }

  protected extractEntryFromBundle(
    root: string,
    entry: string,
    result:
      | vite.Rollup.RollupOutput
      | vite.Rollup.RollupOutput[]
      | vite.Rollup.RollupWatcher,
  ): string {
    const entryFilePath = isAbsolute(entry) ? entry : join(root, entry);

    const normalizedEntryPath = entryFilePath.replace(/\\/g, "/");

    const rollupOutput = (
      Array.isArray(result) ? result[0] : result
    ) as vite.Rollup.RollupOutput;

    const entryFile = rollupOutput.output.find(
      (it) =>
        "facadeModuleId" in it && it.facadeModuleId === normalizedEntryPath,
    )?.fileName;

    if (!entryFile) {
      throw new AlephaError(
        `Could not find the entry file "${entryFilePath}" in the build output. Please check your entry file and try again.`,
      );
    }

    return entryFile;
  }
}
