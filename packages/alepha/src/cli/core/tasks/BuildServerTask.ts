import { createRequire } from "node:module";
import { isAbsolute, join } from "node:path";
import { $inject, Alepha, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import type * as vite from "vite";
import type { UserConfig } from "vite";
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

  /**
   * Memoized chunk parser, resolved on first use by {@link importParseAst}.
   */
  protected parseAst?: (code: string) => any;

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
      const viteAnalyzer = await this.viteUtils.importAnalyzer();
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
            // No `codeSplitting.groups` on purpose — default splitting wins here.
            //
            // This used to force everything matching `node_modules/react(/|-dom/)`
            // into one chunk. That regex covers `react` AND `react-dom/server`,
            // and the two have opposite needs: `react` is ~8KB imported
            // statically by every component module, so its chunk is eager by
            // construction, while `react-dom/server` is ~200KB reached only
            // through `ReactDomServerProvider.load()`. Grouped together, the
            // small eager half pinned the large lazy half into the cold-start
            // graph, and no amount of dynamic-importing at the call sites could
            // move it: eagerness follows chunk membership, not import style.
            //
            // Measured on `apps/lore` (workerd): dropping the group moved the
            // renderer to a genuinely async chunk and took the eagerly-parsed
            // server bundle from ~1556KB to ~1329KB. Splitting the group in two
            // instead — a `react-dom-server` group ahead of a `react` group with
            // a negative lookahead — did NOT work and produced byte-identical
            // output, so reach for a measurement before reintroducing any group
            // here rather than assuming the pattern is what decides.

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
    // Cheap pre-filter. Parsing a chunk that cannot possibly match is pure
    // cost, and the overwhelming majority of chunks import nothing from
    // `node:module`.
    if (!code.includes("node:module") || !code.includes("import.meta")) {
      return code;
    }

    const ast = this.parseChunk(code);

    const aliases = new Set<string>();
    this.walkAst(ast, (node) => {
      if (
        node.type !== "ImportDeclaration" ||
        node.source?.value !== "node:module"
      ) {
        return;
      }
      for (const specifier of node.specifiers ?? []) {
        if (
          specifier.type === "ImportSpecifier" &&
          specifier.imported?.name === "createRequire"
        ) {
          aliases.add(specifier.local?.name ?? "createRequire");
        }
      }
    });
    if (aliases.size === 0) {
      return code;
    }

    const inertFactory =
      `(()=>{const r=(id)=>{` +
      `throw new Error("createRequire is unavailable on workerd; cannot require "+JSON.stringify(id))` +
      `};r.resolve=r;return r})()`;

    const edits: ChunkEdit[] = [];
    this.walkAst(ast, (node) => {
      if (
        node.type === "CallExpression" &&
        node.callee?.type === "Identifier" &&
        aliases.has(node.callee.name) &&
        node.arguments?.length === 1 &&
        this.isImportMetaUrl(node.arguments[0])
      ) {
        edits.push({ start: node.start, end: node.end, text: inertFactory });
      }
    });
    return this.applyEdits(code, edits);
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
    if (!code.includes("import.meta")) {
      return code;
    }

    const stub = JSON.stringify(`file:///server/${fileName}`);
    const edits: ChunkEdit[] = [];
    this.walkAst(this.parseChunk(code), (node) => {
      if (this.isImportMetaUrl(node)) {
        edits.push({ start: node.start, end: node.end, text: stub });
      }
    });
    return this.applyEdits(code, edits);
  }

  /**
   * Parse an emitted chunk with the bundler's own JavaScript parser.
   *
   * Both workerd rewrites used to be `String.replace` over an
   * `import\.meta\.url` pattern, which is wrong for a reason that is not
   * hypothetical: that token is also ordinary *data*. `apps/docs` renders its
   * changelog from commit messages, two of which name the token verbatim, so
   * the rewrite terminated a string literal early. The chunk stopped parsing,
   * rolldown dropped it, and the build still exited 0 — the app entry shipped
   * as a 37-byte file holding nothing but a sourcemap comment, `run()` never
   * executed, and Cloudflare refused the upload with `ReferenceError:
   * __alepha is not defined`.
   *
   * A chunk that cannot be parsed is a chunk that cannot be made safe for
   * workerd, so this throws rather than falling back to a textual rewrite:
   * a named build failure beats a silent artifact that fails validation
   * later (error 10021) with no clue where it came from.
   */
  protected parseChunk(code: string): any {
    this.parseAst ??= this.importParseAst();
    try {
      return this.parseAst(code);
    } catch (error) {
      throw new AlephaError(
        "Failed to parse an emitted server chunk while preparing it for " +
          "workerd. The chunk cannot be made safe for Cloudflare, so the " +
          `build is stopping instead of shipping it: ${String(error)}`,
      );
    }
  }

  /**
   * Lazily resolve the parser, mirroring {@link ViteUtils.importVite}'s
   * rolldown-vite-first resolution so both halves of the build agree on one
   * parser rather than disagreeing about what is valid syntax.
   */
  protected importParseAst(): (code: string) => any {
    // Resolved inline, exactly as `ViteUtils.importVite` does it: neither
    // package is a declared dependency of this workspace (the CLI runs against
    // whichever the host app installed), so a bare `require("…")` literal only
    // teaches depcheck to demand one that must not be added.
    try {
      return createRequire(import.meta.url)("rolldown-vite").parseAst;
    } catch {
      return createRequire(import.meta.url)("vite").parseAst;
    }
  }

  /**
   * Whether a node is the `import.meta.url` meta-property (in either the
   * `import.meta.url` or the `import.meta["url"]` spelling).
   */
  protected isImportMetaUrl(node: any): boolean {
    if (node?.type !== "MemberExpression") {
      return false;
    }
    const object = node.object;
    if (
      object?.type !== "MetaProperty" ||
      object.meta?.name !== "import" ||
      object.property?.name !== "meta"
    ) {
      return false;
    }
    return node.computed
      ? node.property?.type === "Literal" && node.property.value === "url"
      : node.property?.type === "Identifier" && node.property.name === "url";
  }

  /**
   * Depth-first walk over every node of an ESTree program.
   */
  protected walkAst(node: any, visit: (node: any) => void): void {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        this.walkAst(child, visit);
      }
      return;
    }
    if (typeof node.type === "string") {
      visit(node);
    }
    for (const key in node) {
      if (key !== "type" && key !== "start" && key !== "end") {
        this.walkAst(node[key], visit);
      }
    }
  }

  /**
   * Splice offset-addressed replacements into `code`, applying them
   * back-to-front so each edit's offsets stay valid as earlier ones land.
   */
  protected applyEdits(code: string, edits: ChunkEdit[]): string {
    if (edits.length === 0) {
      return code;
    }
    let output = code;
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
      output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
    }
    return output;
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

    const entryChunk = rollupOutput.output.find(
      (it) =>
        "facadeModuleId" in it && it.facadeModuleId === normalizedEntryPath,
    );
    const entryFile = entryChunk?.fileName;

    if (!entryFile) {
      throw new AlephaError(
        `Could not find the entry file "${entryFilePath}" in the build output. Please check your entry file and try again.`,
      );
    }

    this.assertEntryChunkNotEmpty(entryFile, (entryChunk as any)?.code);

    return entryFile;
  }

  /**
   * Refuse an entry chunk that carries no top-level statement.
   *
   * A `renderChunk` rewrite that corrupts a chunk does not fail the build:
   * rolldown drops the unparseable content and emits an empty file, and the
   * build exits 0. What ships is an app whose `run()` never executes — a
   * failure that first surfaces as Cloudflare refusing the upload with
   * `ReferenceError: __alepha is not defined`, a message that points nowhere
   * near the bundler. An entry chunk always at minimum imports the chunk
   * holding the app, so an empty one is always a bug worth stopping for.
   */
  protected assertEntryChunkNotEmpty(
    entryFile: string,
    code: string | undefined,
  ): void {
    if (typeof code !== "string") {
      return;
    }
    if (this.parseChunk(code).body.length > 0) {
      return;
    }
    throw new AlephaError(
      `The server entry chunk "${entryFile}" is empty — it holds no statement ` +
        "at all, so the application would never start. This means a chunk " +
        "transform produced code the bundler could not parse and silently " +
        "dropped. Refusing to ship the build.",
    );
  }
}

/**
 * One offset-addressed replacement inside an emitted chunk: the source range
 * `[start, end)` and the text that takes its place.
 */
interface ChunkEdit {
  start: number;
  end: number;
  text: string;
}
