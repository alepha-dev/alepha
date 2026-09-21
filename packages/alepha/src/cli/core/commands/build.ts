import { $inject, $store, Alepha, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";

import {
  type BuildRuntime,
  type BuildRuntimeDeclaration,
  type BuildTarget,
  buildOptions,
} from "../atoms/buildOptions.ts";
import { metaOptions } from "../atoms/metaOptions.ts";
import { AppEntryProvider } from "../providers/AppEntryProvider.ts";
import { ViteBuildProvider } from "../providers/ViteBuildProvider.ts";
import { BuildFreshness } from "../services/BuildFreshness.ts";
import { BuildSlices } from "../services/BuildSlices.ts";
import { MetaResolver } from "../services/MetaResolver.ts";
import { PackageManagerUtils } from "../services/PackageManagerUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";
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
import type { BuildTaskContext } from "../tasks/BuildTask.ts";

export class BuildCommand {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);
  protected readonly boot = $inject(AppEntryProvider);
  protected readonly viteBuildProvider = $inject(ViteBuildProvider);
  protected readonly options = $store(buildOptions);
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
  protected readonly pipeline = [
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
   * Value aliases accepted for `--target`.
   *
   * These let the CLI accept short forms (e.g. `--target cf`) that are
   * canonicalized to a real {@link BuildTarget} before they flow into the
   * pipeline. The enum in `flags.target` must also list the alias so it
   * passes schema validation.
   */
  protected readonly targetAliases: Record<string, BuildTarget> = {
    cf: "cloudflare",
  };

  /**
   * Canonicalize a raw `--target` value, mapping any known alias
   * (e.g. `cf` → `cloudflare`) to its real {@link BuildTarget}.
   */
  protected resolveTarget(target: string | undefined): BuildTarget | undefined {
    if (!target) {
      return undefined;
    }
    return this.targetAliases[target] ?? (target as BuildTarget);
  }

  /**
   * Resolve the ordered slice set from the target and the declared runtimes.
   *
   * Some targets force a specific runtime:
   * - `cloudflare` always uses `workerd`
   * - `docker` and bare deployments respect the declaration
   *
   * ⚠️ The order of the returned list is the build's decision and is preserved
   * end to end: the first entry is the primary. Nothing downstream may sort it.
   *
   * @throws {AlephaError} If a target cannot hold the runtimes asked for
   */
  protected resolveRuntimes(
    target: BuildTarget | undefined,
    declared: BuildRuntimeDeclaration | undefined,
  ): BuildRuntime[] {
    if (target === "cloudflare") {
      // `--target=cloudflare` is the old way of saying "link for workerd", and
      // it can only mean one slice: the wrangler upload has exactly one entry
      // point. Asking for anything else is a contradiction worth naming rather
      // than silently narrowing.
      //
      // ⚠️ Read from what was DECLARED, not from the resolved list: resolving
      // first turns "nothing was asked for" into the `node` default, and this
      // target would then refuse a build that named no runtime at all.
      if (declared) {
        const asked = Array.isArray(declared) ? declared : [declared];
        if (asked.some((runtime) => runtime !== "workerd")) {
          throw new AlephaError(
            `Target 'cloudflare' requires the 'workerd' runtime, got '${asked.join(",")}'`,
          );
        }
      }
      return ["workerd"];
    }
    return this.slices.resolve(declared);
  }

  public readonly build = $command({
    name: "build",
    mode: "production",
    description: "Build the project for production",
    flags: z.object({
      stats: z
        .union([z.boolean(), z.enum(["json"])])
        .describe("Generate build stats report")
        .optional(),
      target: z
        .enum(["bare", "docker", "cloudflare", "cf", "static"])
        .meta({ aliases: ["t"] })
        .describe("Deployment target (cf = cloudflare)")
        .optional(),
      runtime: z
        .text()
        .meta({ aliases: ["r"] })
        .describe(
          "Runtimes to link the server for, comma-separated and in order: node, bun, workerd. The first is the primary — what the manifest names, what dist/package.json points at, and what a deployer spawns. e.g. --runtime node,workerd",
        )
        .optional(),
      prebuilt: z
        .boolean()
        .describe(
          "Skip the bundle steps (Vite client/server + asset compression). Only regenerates target-specific deploy config (e.g. wrangler.jsonc). Use when `dist/` is already built and you just need the config refreshed.",
        )
        .optional(),
      ifStale: z
        .boolean()
        // Every other flag here is one word, so camelCase has no precedent to
        // follow and `--ifStale` reads badly. The alias is the spelling meant
        // to be used and written down; the key stays camelCase because that
        // is what the schema and `flags.ifStale` need.
        .meta({ aliases: ["if-stale"] })
        .describe(
          "Build only when `dist/` is missing or older than the sources it was built from (the app's own src/public/migrations plus every workspace dependency it bundles). Use in a pipeline that builds and then runs the build, so the second invocation is a no-op instead of a full rebuild.",
        )
        .optional(),
    }),
    handler: async ({ flags, run, root }) => {
      process.env.NODE_ENV = "production";

      if (await this.pm.hasExpo(root)) {
        // will come soon
        return;
      }

      await this.scaffolder.ensureConfig(root, {
        tsconfigJson: true,
      });

      const entry = await this.boot.getAppEntry(root);
      this.log.trace("Entry file found", { entry });

      // Resolve flags → mutate the atom (single source of truth)
      this.alepha.store.mut(buildOptions, (current) => {
        const target = this.resolveTarget(flags.target) ?? current.target;
        // The flag is a comma-separated list so one flag carries the order.
        // It replaces the declaration outright rather than merging with it:
        // a caller that names a set means that set, and a union would make
        // `--runtime workerd` silently also build whatever the config asked
        // for.
        const runtimes = this.resolveRuntimes(
          target,
          this.slices.parseFlag(flags.runtime) ?? current.runtime,
        );
        // Resolved into BOTH fields, the same relationship the manifest
        // carries: the scalar is the primary and is always `runtimes[0]`, so a
        // task reading one cannot disagree with a task reading the other.
        const runtime = this.slices.primary(runtimes);
        return {
          ...current,
          stats: flags.stats ?? current.stats ?? false,
          target,
          runtime,
          runtimes,
        };
      });

      const options = this.options;

      const distDir = options.output?.dist ?? "dist";

      // `--if-stale`: leave a current `dist/` alone and do nothing.
      //
      // Checked here rather than inside a task because the answer is "run no
      // task at all", and before `clean dist` because that step is what would
      // destroy the artifact being judged.
      if (flags.ifStale) {
        const reason = await this.freshness.staleReason(root, distDir);
        if (!reason) {
          this.log.info(`${distDir} is up to date, skipping build`);
          return;
        }
        this.log.info(`Building: ${reason}`);
      }

      // Prebuilt mode: skip clean + Vite builds + asset compression; only
      // regenerate target-specific deploy config (e.g. wrangler.jsonc).
      // Used by external orchestrators (Rocket) that ship a pre-built
      // dist/ and just need the config refreshed for per-deploy overrides.
      if (!flags.prebuilt) {
        await run.rm(distDir, { alias: "clean dist" });
      }

      const { target } = options;

      this.log.trace("Build configuration", {
        target,
        runtimes: options.runtimes,
      });

      // Prebuilt + manifest fast-path: skip `analyze app` (which boots
      // the workspace via Vite and requires its full node_modules tree).
      // BuildCloudflareTask reads from `ctx.manifest` instead of from
      // `ctx.alepha` in this mode. Falls back to the introspection path
      // when no manifest is present (older artifacts).
      let manifest: Awaited<ReturnType<typeof this.loadManifest>> = null;
      if (flags.prebuilt) {
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

      // Read platformOptions from the CLI's Alepha instance — this is
      // where alepha.config.ts wrote them during the configure hook.
      // The workspace's appAlepha (from Vite) is a separate instance
      // and doesn't have these. Captured here so BuildCloudflareTask
      // can serialize them into dist/manifest.json without needing to
      // re-load alepha.config.ts at deploy time.
      const platformOptions =
        (this.alepha.store.get("alepha.cli.platform.options") as
          | BuildTaskContext["platformOptions"]
          | undefined) ?? null;

      // Resolved once, before the pipeline, so every task that bakes it into a
      // bundle bakes the same record. `runtime` follows the manifest's rule:
      // a static build names no interpreter.
      const meta = await this.metaResolver.resolve({
        root,
        // The PRIMARY slice, which is what a deployer spawns. A multi-slice
        // build bakes one `alepha.meta` into every slice, and naming a
        // secondary there would have a Worker report the runtime of a bundle
        // it is not.
        runtime:
          options.target === "static"
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
        platformOptions,
        flags: { prebuilt: flags.prebuilt },
      };

      for (const task of this.pipeline) {
        await task.run(ctx);
      }
    },
  });

  /**
   * Read `dist/manifest.json` produced by a previous `alepha build`.
   * Returns null when absent or unparseable — caller falls back to the
   * Vite-introspection path.
   */
  protected async loadManifest(root: string) {
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const raw = await fs.readFile(
        path.join(root, "dist", "manifest.json"),
        "utf-8",
      );
      return JSON.parse(
        raw,
      ) as import("../schemas/buildManifest.ts").BuildManifest;
    } catch {
      return null;
    }
  }
}
