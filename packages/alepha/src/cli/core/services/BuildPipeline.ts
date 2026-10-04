import { $inject, $store, Alepha, AlephaError } from "alepha";
import type { RunnerMethod } from "alepha/command";
import { $logger } from "alepha/logger";

import {
  type BuildOptions,
  type BuildRuntimeDeclaration,
  buildOptions,
} from "../atoms/buildOptions.ts";
import { metaOptions } from "../atoms/metaOptions.ts";
import { AppEntryProvider } from "../providers/AppEntryProvider.ts";
import { ViteBuildProvider } from "../providers/ViteBuildProvider.ts";
import type { BuildManifest } from "../schemas/buildManifest.ts";
import { BuildAssetsTask } from "../tasks/BuildAssetsTask.ts";
import { BuildClientTask } from "../tasks/BuildClientTask.ts";
import { BuildCloudflareTask } from "../tasks/BuildCloudflareTask.ts";
import { BuildCompressTask } from "../tasks/BuildCompressTask.ts";
import { BuildHeadersTask } from "../tasks/BuildHeadersTask.ts";
import { BuildManifestTask } from "../tasks/BuildManifestTask.ts";
import { BuildPrerenderTask } from "../tasks/BuildPrerenderTask.ts";
import { BuildPwaTask } from "../tasks/BuildPwaTask.ts";
import { BuildServerTask } from "../tasks/BuildServerTask.ts";
import { BuildStaticTask } from "../tasks/BuildStaticTask.ts";
import type { BuildTask, BuildTaskContext } from "../tasks/BuildTask.ts";
import { BuildFreshness } from "./BuildFreshness.ts";
import { BuildSlices } from "./BuildSlices.ts";
import { MetaResolver } from "./MetaResolver.ts";
import { PackageManagerUtils } from "./PackageManagerUtils.ts";
import { ProjectScaffolder } from "./ProjectScaffolder.ts";

/**
 * The `alepha build` pipeline, callable in process.
 *
 * `alepha build` is a thin command over {@link build}. Anything else that
 * needs the same artifact with a twist calls it too: `@alepha/capacitor`
 * builds the app's static shell into its own directory, with its own browser
 * constants, without shelling out to a second CLI and without moving the
 * server build.
 *
 * ## Overrides belong to the call, not to the project
 *
 * A {@link BuildRequest} may name a runtime, an output directory and client
 * constants. They apply to that call only: the project's `buildOptions` atom
 * is left as `alepha.config.ts` set it, unless the request asks for
 * `persist`, which is what `alepha build` itself does so that whatever runs
 * after it in the same process (a platform deploy) reads the resolved runtime.
 *
 * ## An app shell
 *
 * `shell: true` is a static build reduced to what a WebView loads: the
 * client bundle and an `index.html` with an empty root. It renders no page
 * (so it runs no loader and needs no API at build time), and writes none of
 * what a static host reads and a WebView never asks for: no `.br`/`.gz`
 * sidecars, no `_headers`, no `CNAME`, no `200.html` or `404.html`.
 */
export class BuildPipeline {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);
  protected readonly boot = $inject(AppEntryProvider);
  protected readonly viteBuildProvider = $inject(ViteBuildProvider);
  protected readonly projectOptions = $store(buildOptions);
  protected readonly metaResolver = $inject(MetaResolver);
  protected readonly metaOverride = $store(metaOptions);
  protected readonly freshness = $inject(BuildFreshness);
  protected readonly slices = $inject(BuildSlices);

  /**
   * Build pipeline: tasks run sequentially in this order.
   * Each task self-guards (checks target, hasClient, etc.).
   * Order matters: compress runs after everything that writes public files.
   * `_headers` is written after the static task, which copies an adopted
   * site (and its own `_headers`) into `dist/public`.
   *
   * ⚠️ There is no compile step here any more. It was `alepha build
   * --compile`, a build option that reached back to constrain `target`, and it
   * is `alepha compile` now — its own command, reading `./dist`.
   */
  protected readonly tasks: BuildTask[] = [
    $inject(BuildClientTask),
    $inject(BuildServerTask),
    $inject(BuildAssetsTask),
    $inject(BuildPwaTask),
    $inject(BuildPrerenderTask),
    // Before the target-specific config tasks: `dist/` exists by now, and
    // anything generating deploy config may want to read what was captured.
    $inject(BuildManifestTask),
    $inject(BuildCloudflareTask),
    $inject(BuildStaticTask),
    $inject(BuildHeadersTask),
    $inject(BuildCompressTask),
  ];

  /**
   * Resolve the options of one build: the project's, with this request's
   * overrides on top, and the runtime declaration resolved into its slices.
   *
   * ⚠️ The order of the resolved slice list is the build's decision and is
   * preserved end to end: the first entry is the primary. Nothing downstream
   * may sort it. A static declaration resolves to NO slices, which is what
   * makes the server link skip entirely rather than build a bundle the static
   * task deletes.
   */
  public resolveOptions(request: BuildRequest): BuildOptions {
    const current = this.projectOptions;

    // A shell is a static build by definition: there is no server in a
    // WebView. The declaration is replaced rather than merged with the
    // project's, the way the `--runtime` flag replaces it: a caller that names
    // a set means that set.
    const declared = request.shell
      ? "static"
      : (request.runtime ?? current.runtime);
    const runtimes = this.slices.resolve(declared);
    const isStatic = this.slices.isStatic(declared);

    // Resolved into BOTH fields, the same relationship the manifest carries:
    // the scalar is the primary and is always `runtimes[0]`, so a task reading
    // one cannot disagree with a task reading the other. A static build has no
    // slices, and the scalar says so.
    const runtime: BuildRuntimeDeclaration = isStatic
      ? "static"
      : this.slices.primary(runtimes);

    return {
      ...current,
      stats: request.stats ?? current.stats ?? false,
      runtime,
      runtimes,
      output: request.output
        ? { ...current.output, ...request.output }
        : current.output,
    };
  }

  /**
   * Run the whole pipeline once.
   */
  public async build(request: BuildRequest): Promise<BuildResult> {
    const { root, run } = request;
    process.env.NODE_ENV = "production";

    if (await this.pm.hasExpo(root)) {
      // will come soon
      return { skipped: true };
    }

    await this.scaffolder.ensureConfig(root, {
      tsconfigJson: true,
    });

    const entry = await this.boot.getAppEntry(root);
    this.log.trace("Entry file found", { entry });

    const options = this.resolveOptions(request);
    if (request.persist) {
      this.alepha.store.set(buildOptions, options);
    }

    const distDir = options.output?.dist ?? "dist";

    // `ifStale`: leave a current `dist/` alone and do nothing.
    //
    // Checked here rather than inside a task because the answer is "run no
    // task at all", and before `clean dist` because that step is what would
    // destroy the artifact being judged.
    if (request.ifStale) {
      const reason = await this.freshness.staleReason(root, distDir);
      if (!reason) {
        this.log.info(`${distDir} is up to date, skipping build`);
        return { skipped: true, options };
      }
      this.log.info(`Building: ${reason}`);
    }

    // Prebuilt mode: skip clean + Vite builds + asset compression; only
    // regenerate target-specific deploy config (e.g. wrangler.jsonc).
    // Used by external orchestrators (Rocket) that ship a pre-built
    // dist/ and just need the config refreshed for per-deploy overrides.
    if (!request.prebuilt) {
      await run.rm(distDir, { alias: "clean dist" });
    }

    this.log.trace("Build configuration", {
      runtimes: options.runtimes,
      static: this.slices.isStaticBuild(options),
      shell: !!request.shell,
    });

    // Prebuilt + manifest fast-path: skip `analyze app` (which boots
    // the workspace via Vite and requires its full node_modules tree).
    // BuildCloudflareTask reads from `ctx.manifest` instead of from
    // `ctx.alepha` in this mode. Falls back to the introspection path
    // when no manifest is present (older artifacts).
    let manifest: BuildManifest | null = null;
    if (request.prebuilt) {
      manifest = await this.loadManifest(root);
    }

    let appAlepha: Alepha | undefined;
    let hasClient = false;

    if (!manifest) {
      await run({
        name: "analyze app",
        handler: async () => {
          appAlepha = await this.viteBuildProvider.init({ entry });
          hasClient = this.viteBuildProvider.hasClient();
        },
      });

      if (!appAlepha) {
        throw new AlephaError("Alepha instance not found");
      }
    }

    // Resolved once, before the pipeline, so every task that bakes it into a
    // bundle bakes the same record. `runtime` follows the manifest's rule:
    // a static build names no interpreter.
    const meta = await this.metaResolver.resolve({
      root,
      // The PRIMARY slice, which is what a deployer spawns. A multi-slice
      // build bakes one `alepha.meta` into every slice, and naming a
      // secondary there would have a Worker report the runtime of a bundle
      // it is not. A static build names no interpreter.
      runtime: this.slices.isStaticBuild(options)
        ? "static"
        : this.slices.primary(this.slices.fromOptions(options)),
      dev: false,
      override: this.metaOverride,
    });

    // The prerender runs in THIS process, not in a bundle, so `define` never
    // reaches it. Installed before the pipeline so anything the build renders
    // in-process reads the same record the bundles carry.
    this.metaResolver.install(meta);

    const ctx: BuildTaskContext = {
      // Cast: when manifest mode is active, BuildCloudflareTask reads
      // from ctx.manifest and never dereferences ctx.alepha. Bundle
      // tasks (BuildClient/Server/etc.) self-guard on ctx.flags.prebuilt
      // and return early, so they don't touch alepha either.
      alepha: (appAlepha ?? null) as unknown as Alepha,
      options,
      root,
      run,
      entry,
      hasClient,
      meta,
      manifest,
      define: request.define,
      flags: { prebuilt: request.prebuilt, shell: request.shell },
    };

    for (const task of this.tasks) {
      await task.run(ctx);
    }

    return { skipped: false, options };
  }

  /**
   * Read `dist/manifest.json` produced by a previous `alepha build`.
   * Returns null when absent or unparseable — caller falls back to the
   * Vite-introspection path.
   */
  protected async loadManifest(root: string): Promise<BuildManifest | null> {
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const raw = await fs.readFile(
        path.join(root, "dist", "manifest.json"),
        "utf-8",
      );
      return JSON.parse(raw) as BuildManifest;
    } catch {
      return null;
    }
  }
}

/**
 * One call to {@link BuildPipeline.build}.
 */
export interface BuildRequest {
  /**
   * The project root.
   */
  root: string;

  /**
   * The CLI runner the tasks report through.
   */
  run: RunnerMethod;

  /**
   * Runtimes to build for, replacing the project's `build.runtime` for this
   * call. `static` declares an app with no server.
   */
  runtime?: BuildRuntimeDeclaration;

  /**
   * Where this build writes, replacing the project's `build.output` keys it
   * names. The clean step removes `output.dist` and nothing else, so a build
   * into `dist-capacitor` leaves the server's `dist/` alone.
   */
  output?: {
    dist?: string;
    public?: string;
  };

  /**
   * Constants added to the client bundle's Vite `define`, already encoded as
   * source text (`JSON.stringify(value)`), the way `__ALEPHA_META__` is.
   *
   * Browser code has no other channel for build-time configuration:
   * `alepha.env` is empty in the browser. Never put a secret here; whatever is
   * defined ships in a file anyone can read.
   */
  define?: Record<string, string>;

  /**
   * An app shell: a lean static build for a WebView. See {@link BuildPipeline}.
   */
  shell?: boolean;

  /**
   * Generate a bundle stats report.
   */
  stats?: boolean | "json";

  /**
   * Skip the bundle steps and only regenerate deploy config.
   */
  prebuilt?: boolean;

  /**
   * Build only when the output is missing or older than its sources.
   */
  ifStale?: boolean;

  /**
   * Write the resolved options back to the `buildOptions` atom, as `alepha
   * build` does. Off by default: an in-process caller's overrides stay its
   * own.
   */
  persist?: boolean;
}

/**
 * What one call to {@link BuildPipeline.build} did.
 */
export interface BuildResult {
  /**
   * True when nothing was built: an Expo project, or `ifStale` found the
   * output current.
   */
  skipped: boolean;

  /**
   * The options the build ran with, overrides applied.
   */
  options?: BuildOptions;
}
