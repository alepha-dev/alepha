import { createRequire } from "node:module";
import { isAbsolute, join } from "node:path";

import { $inject, Alepha, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import type * as vite from "vite";
import type { UserConfig } from "vite";

import type { BuildRuntime } from "../atoms/buildOptions.ts";
import { BuildSlices } from "../services/BuildSlices.ts";
import { MetaResolver } from "../services/MetaResolver.ts";
import {
  type PreloadTable,
  PreloadTableBuilder,
} from "../services/PreloadTableBuilder.ts";
import { ViteUtils } from "../services/ViteUtils.ts";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

/**
 * Build the server-side SSR bundle with Vite — one **slice** per runtime.
 *
 * Compiles the server code for production, generates the externals
 * `package.json`, and writes one `dist/index.<runtime>.js` entry wrapper per
 * slice over its own `dist/server/<runtime>/` chunk directory.
 *
 * ## Why only this task loops
 *
 * The runtimes differ by almost nothing: one export condition, plus the
 * workerd `createRequire` shim and, for a `$websocket` app, a generated entry
 * re-exporting the Durable Object class. Everything else about the Vite config
 * is identical. `BuildClientTask` never reads the runtime at all and
 * `BuildPrerenderTask` renders from the live container rather than from a
 * built bundle, so neither has a slice question — which is the whole point of
 * the epic: the slow steps run once and only the server link repeats.
 *
 * ## ⚠️ What must happen exactly once, inside a loop
 *
 * Three things here are per-BUILD and not per-slice, and doing them per slice
 * is silently wrong rather than loud:
 *
 * - The client `index.html` is removed once the server takes over rendering it.
 *   Removed on the first pass, it is simply absent for the second.
 * - The client's `.vite` manifest directory is consumed to build the preload
 *   table and then deleted. Deleted after the first slice, every later slice
 *   ships with no preload table at all and nothing says so.
 * - `dist/package.json` names ONE `main`, which is the primary slice.
 *
 * So the manifests are read once and reused, and the two deletions happen
 * after the loop.
 */
export class BuildServerTask extends BuildTask {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly viteUtils = $inject(ViteUtils);
  protected readonly metaResolver = $inject(MetaResolver);
  protected readonly preloadTable = $inject(PreloadTableBuilder);
  protected readonly slices = $inject(BuildSlices);

  /**
   * Whether the Durable Object class should be re-exported through the app's
   * server bundle. Set to `true` only for a `workerd` build of an app that uses
   * the `$websocket` primitive. Any other build leaves this `false`, so the
   * generated bundle and the slice's entry wrapper carry nothing extra.
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

    // Declared order, straight from the resolved options. Never sorted: the
    // first entry is the primary, and reordering it here would change what
    // `dist/package.json` points at and what a deployer spawns.
    const runtimes = this.slices.resolve(
      ctx.options.runtimes ?? ctx.options.runtime,
    );

    // Read once and reused by every slice: the client bundle is
    // runtime-agnostic, so its manifests answer the same for all of them, and
    // reading them again after the first pass deleted `.vite` would answer
    // nothing at all.
    let ssr: SsrManifest | undefined;
    let primaryExternals: string[] = [];

    for (const runtime of runtimes) {
      await ctx.run({
        // Named per slice so a failing multi-runtime build says which link
        // failed rather than "build server".
        name:
          runtimes.length > 1 ? `build server (${runtime})` : "build server",
        handler: async () => {
          const built = await this.buildServer({
            root: ctx.root,
            entry: ctx.entry.server,
            distDir,
            runtime,
            clientDir: clientBuilt ? publicDir : undefined,
            stats,
            silent: !isCI,
            alepha: ctx.alepha,
            meta: ctx.meta ? this.metaResolver.define(ctx.meta) : undefined,
            allowUnresolvedPreloads: ctx.options.preload?.allowUnresolved,
            ssr,
          });
          ssr ??= built.ssr;
          if (runtime === this.slices.primary(runtimes)) {
            primaryExternals = built.externals;
          }
        },
      });
    }

    // `main` names ONE file, and the primary is the honest answer: it is what
    // the manifest declares and what a deployer without slice support spawns.
    // The externals are the primary's too — a workerd slice externalizes
    // nothing and a bun slice externalizes less, so taking any other slice's
    // list would under-declare what `node .` needs.
    await this.generateExternals(
      distDir,
      primaryExternals,
      this.slices.entryFileName(this.slices.primary(runtimes)),
    );

    // Both deletions after the loop. See the class doc: doing either inside it
    // leaves every slice after the first missing something, silently.
    if (clientBuilt) {
      // The server renders index.html once both halves are built.
      await this.fs.rm(clientIndexPath);
    }
    if (ssr?.viteDir) {
      await this.fs.rm(ssr.viteDir, { recursive: true });
    }
  }

  protected async buildServer(opts: {
    root: string;
    entry: string;
    distDir: string;
    /**
     * The runtime this slice is linked for. Decides the export condition, the
     * chunk directory and the entry wrapper's name.
     */
    runtime: BuildRuntime;
    clientDir?: string;
    stats?: boolean | "json";
    silent?: boolean;
    alepha: Alepha;
    /**
     * The client manifests, already read and resolved by an earlier slice.
     *
     * Present for every slice after the first. The client bundle is
     * runtime-agnostic, so re-reading would produce the same answer — and
     * cannot anyway, since the directory it reads is deleted once the build is
     * over.
     */
    ssr?: SsrManifest;
    /**
     * The build metadata token, already encoded as a `define` entry. The same
     * one the client bundle gets.
     */
    meta?: Record<string, string>;
    /**
     * Source paths whose preload key may resolve to no chunks without failing
     * the build.
     */
    allowUnresolvedPreloads?: string[];
  }): Promise<{ entryFile: string; externals: string[]; ssr?: SsrManifest }> {
    const serverDir = this.slices.serverDir(opts.runtime);
    const conditions: string[] = [];
    if (opts.runtime === "bun") {
      conditions.push("bun");
    } else if (opts.runtime === "workerd") {
      conditions.push("workerd");
    }
    const { build: viteBuild, resolveConfig } =
      await this.viteUtils.importVite();
    const plugins: any[] = [];

    const viteReact = await this.viteUtils.importViteReact();
    if (viteReact && opts.clientDir) {
      plugins.push(viteReact());
    }

    plugins.push(this.viteUtils.createTsconfigPathsPlugin());
    plugins.push(this.viteUtils.createSsrPreloadPlugin());
    plugins.push(this.viteUtils.createClientModulesPlugin());

    if (conditions.includes("workerd")) {
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

    const resolveConditions = ["node", "import", "module", "default"];
    resolveConditions.unshift(...conditions);

    // Cloudflare ships `dist/index.workerd.js` + `dist/server/workerd/*.js`
    // under `no_bundle`
    // (no node_modules). For the `AlephaWebSocketDurableObject` class named in
    // the wrangler `durable_objects`/`migrations` config to be reachable at the
    // edge, it must ride out through the app's own server bundle as a real
    // named export. Only do this for a workerd build of an app that actually
    // uses `$websocket` or `$room` — every other build stays untouched.
    this.exportDurableObject =
      conditions.includes("workerd") && this.usesWebSocket(opts.alepha);

    // For the entry chunk to carry the named export, build from a generated
    // entry that both runs the real app entry (for its side effects) and
    // re-exports the DO class. The same `entry` is passed to `build.ssr` and
    // to `extractEntryFromBundle`, so the facade chunk is found.
    let entry = opts.entry;
    if (this.exportDurableObject) {
      const entryAbsolute = isAbsolute(opts.entry)
        ? opts.entry
        : join(opts.root, opts.entry);
      // Named after the runtime: two slices generating the same file would
      // race, and only one of them builds what it thinks it built.
      const generated = `${opts.distDir}/.alepha-${opts.runtime}-entry.mjs`;
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
        // The build metadata token. Baked into BOTH bundles from the one
        // record on `ctx.meta`, so `alepha.meta` reads the same answer in the
        // browser as it does on the server.
        ...opts.meta,
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
        resolve: { conditions: resolveConditions },
      },
      build: {
        ssr: entry,
        minify: true,
        sourcemap: true,
        chunkSizeWarningLimit: 10000,
        // ⚠️ Namespaced by runtime. Two slices in one `server/` do not
        // collide — their content hashes differ — so both sets sit there and
        // the wrangler `server/*.js` glob sweeps the Node chunks into the
        // Worker upload. See BuildSlices.serverDir.
        outDir: `${opts.distDir}/${serverDir}`,
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

    const entryFile = this.extractEntryFromBundle(opts.root, entry, result);

    // Read once per BUILD, not once per slice. The directory it reads is
    // deleted by `run` after the last slice, so a second read would find
    // nothing and every slice past the first would ship an empty preload
    // table with nothing going red.
    let ssr = opts.ssr;
    if (opts.clientDir && !ssr) {
      ssr = await this.readSsrManifest({
        distDir: opts.distDir,
        clientDir: opts.clientDir,
        base: resolvedConfig.base,
        allowUnresolvedPreloads: opts.allowUnresolvedPreloads,
      });
    }

    if (ssr?.data) {
      opts.alepha.store.set("alepha.react.ssr.manifest" as any, ssr.data);
    }

    const warning =
      "// This file was automatically generated. DO NOT MODIFY." +
      "\n" +
      "// Changes to this file will be lost when the code is regenerated.\n";

    await this.fs.writeFile(
      `${opts.distDir}/${this.slices.entryFileName(opts.runtime)}`,
      `${warning}\nimport './${serverDir}/${entryFile}';\n${this.durableObjectReexport(serverDir, entryFile)}\n${ssr?.statement ?? ""}`.trim(),
    );

    return { entryFile, externals, ssr };
  }

  /**
   * Read the client build's manifests and turn them into the SSR payload the
   * entry wrapper carries.
   *
   * Extracted from {@link buildServer} because it is per-BUILD while that is
   * per-slice: the client bundle never reads the runtime, so the answer is the
   * same for every slice, and the `.vite` directory it reads exists only until
   * the build removes it.
   */
  protected async readSsrManifest(opts: {
    distDir: string;
    clientDir: string;
    base: string | undefined;
    allowUnresolvedPreloads?: string[];
  }): Promise<SsrManifest> {
    const viteDir = `${opts.distDir}/${opts.clientDir}/.vite`;
    const clientManifest = await this.loadJsonFile(`${viteDir}/manifest.json`);
    const preloadManifest = await this.loadJsonFile(
      `${viteDir}/preload-manifest.json`,
    );
    const ssrManifest = await this.loadJsonFile(`${viteDir}/ssr-manifest.json`);

    let base = opts.base || "/";
    if (!base.startsWith("/")) {
      base = `/${base}`;
    }
    if (base.length > 1 && base.endsWith("/")) {
      base = base.slice(0, -1);
    }

    const favicon = await this.detectFavicon(
      `${opts.distDir}/${opts.clientDir}`,
    );

    const data = {
      // This is the only point in the pipeline holding every manifest at
      // once, so it is the only one that can resolve a preload key - and the
      // only one that can refuse to.
      preload: clientManifest
        ? this.preloadTable.build({
            clientManifest,
            preloadManifest: preloadManifest ?? {},
            ssrManifest: ssrManifest ?? {},
            base: base === "/" ? "" : base,
            allowUnresolved: opts.allowUnresolvedPreloads,
          })
        : undefined,
      favicon,
    };

    return {
      viteDir,
      data,
      // Compact, not pretty-printed: the payload is an index table, and one
      // integer per line tripled the size of a generated file nobody reads.
      statement: `__alepha.set("alepha.react.ssr.manifest", ${JSON.stringify(data)});\n`,
    };
  }

  /**
   * Re-export line appended to the workerd slice's entry wrapper so the
   * Durable Object class rides
   * out through the app's own (`no_bundle`) server bundle and is reachable from
   * the generated Cloudflare worker entry (`main.cloudflare.js` does
   * `export { AlephaWebSocketDurableObject } from "./index.workerd.js"`).
   *
   * Returns an empty string for any build that is not a workerd +
   * `$websocket`/`$room` build, so every other slice's wrapper carries nothing
   * extra.
   */
  protected durableObjectReexport(
    serverDir: string,
    entryFile: string,
  ): string {
    if (!this.exportDurableObject) {
      return "";
    }
    return `export { AlephaWebSocketDurableObject } from "./${serverDir}/${entryFile}";\n`;
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
    main: string,
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
      // The primary slice. `node .` has to resolve to something runnable, and
      // there is exactly one `main` to name it with, so the first declared
      // runtime is the answer — the same one the manifest gives.
      main,
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
 * The client build's manifests, resolved once and shared by every slice.
 */
interface SsrManifest {
  /**
   * The `.vite` directory the manifests came from, removed once the last slice
   * is built.
   */
  viteDir: string;
  data: {
    preload?: PreloadTable;
    favicon?: string;
  };
  /**
   * The `__alepha.set(...)` line appended to each slice's entry wrapper.
   */
  statement: string;
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
