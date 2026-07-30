import { $inject, $state, Alepha, AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import {
  type BuildRuntime,
  type BuildTarget,
  buildOptions,
} from "../atoms/buildOptions.ts";
import { AppEntryProvider } from "../providers/AppEntryProvider.ts";
import { ViteBuildProvider } from "../providers/ViteBuildProvider.ts";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { PackageManagerUtils } from "../services/PackageManagerUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";
import { BuildAssetsTask } from "../tasks/BuildAssetsTask.ts";
import { BuildClientTask } from "../tasks/BuildClientTask.ts";
import { BuildCloudflareTask } from "../tasks/BuildCloudflareTask.ts";
import { BuildCompressTask } from "../tasks/BuildCompressTask.ts";
import { BuildDockerTask } from "../tasks/BuildDockerTask.ts";
import { BuildManifestTask } from "../tasks/BuildManifestTask.ts";
import { BuildPrerenderTask } from "../tasks/BuildPrerenderTask.ts";
import { BuildPwaTask } from "../tasks/BuildPwaTask.ts";
import { BuildServerTask } from "../tasks/BuildServerTask.ts";
import { BuildStaticTask } from "../tasks/BuildStaticTask.ts";
import type { BuildTaskContext } from "../tasks/BuildTask.ts";
import { BuildVercelTask } from "../tasks/BuildVercelTask.ts";

export class BuildCommand {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);
  protected readonly boot = $inject(AppEntryProvider);
  protected readonly viteBuildProvider = $inject(ViteBuildProvider);
  protected readonly options = $state(buildOptions);

  /**
   * Build pipeline: tasks run sequentially in this order.
   * Each task self-guards (checks target, hasClient, etc.).
   * Order matters — compress must be last.
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
    $inject(BuildVercelTask),
    $inject(BuildCloudflareTask),
    $inject(BuildDockerTask),
    $inject(BuildStaticTask),
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
   * Resolve the effective runtime based on target and explicit runtime flag.
   *
   * Some targets force a specific runtime:
   * - `cloudflare` always uses `workerd`
   * - `vercel` always uses `node`
   * - `docker` and bare deployments respect the runtime flag
   *
   * @throws {AlephaError} If an incompatible runtime is specified for a target
   */
  protected resolveRuntime(
    target: BuildTarget | undefined,
    runtime: BuildRuntime | undefined,
  ): BuildRuntime {
    if (target === "cloudflare") {
      if (runtime && runtime !== "workerd") {
        throw new AlephaError(
          `Target 'cloudflare' requires 'workerd' runtime, got '${runtime}'`,
        );
      }
      return "workerd";
    }

    if (target === "vercel") {
      if (runtime && runtime !== "node") {
        throw new AlephaError(
          `Target 'vercel' requires 'node' runtime, got '${runtime}'`,
        );
      }
      return "node";
    }

    return runtime ?? "node";
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
        .enum(["bare", "docker", "vercel", "cloudflare", "cf", "static"])
        .meta({ aliases: ["t"] })
        .describe("Deployment target (cf = cloudflare)")
        .optional(),
      runtime: z
        .enum(["node", "bun", "workerd"])
        .meta({ aliases: ["r"] })
        .describe("JavaScript runtime")
        .optional(),
      image: z
        .union([z.boolean(), z.text()])
        .meta({ aliases: ["i"] })
        .describe(
          "Build Docker image. Use -i for latest, -i=<version> for specific version",
        )
        .optional(),
      compile: z
        .boolean()
        .meta({ aliases: ["c"] })
        .describe(
          "Compile server to a single static binary (requires --target=docker --runtime=bun)",
        )
        .optional(),
      prebuilt: z
        .boolean()
        .describe(
          "Skip the bundle steps (Vite client/server + asset compression). Only regenerates target-specific deploy config (e.g. wrangler.jsonc). Use when `dist/` is already built and you just need the config refreshed.",
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
        return {
          ...current,
          stats: flags.stats ?? current.stats ?? false,
          target,
          runtime: this.resolveRuntime(
            target,
            flags.runtime ?? current.runtime,
          ),
          ...(flags.compile !== undefined && {
            docker: {
              ...current.docker,
              // The flag is explicit intent and wins outright. The old
              // `flags.compile ? (current.docker?.compile ?? true) : false`
              // let a config `compile: false` swallow an explicit `--compile`,
              // because the `?? true` only rescued `undefined`.
              compile: flags.compile,
            },
          }),
        };
      });

      const options = this.options;

      const distDir = options.output?.dist ?? "dist";

      // Prebuilt mode: skip clean + Vite builds + asset compression; only
      // regenerate target-specific deploy config (e.g. wrangler.jsonc).
      // Used by external orchestrators (Rocket) that ship a pre-built
      // dist/ and just need the config refreshed for per-tenant overrides.
      if (!flags.prebuilt) {
        await run.rm(distDir, { alias: "clean dist" });
      }

      const { target } = options;

      // Validate --image requires --target=docker
      if (flags.image && target !== "docker") {
        throw new AlephaError(
          `Flag '--image' requires '--target=docker', got '${target ?? "bare"}'`,
        );
      }

      // Validate --compile requires --target=docker --runtime=bun
      if (options.docker?.compile) {
        if (target !== "docker") {
          throw new AlephaError(
            `Compile mode requires '--target=docker', got '${target ?? "bare"}'`,
          );
        }
        if (options.runtime !== "bun") {
          throw new AlephaError(
            `Compile mode requires '--runtime=bun', got '${options.runtime}'`,
          );
        }
      }

      this.log.trace("Build configuration", {
        target,
        runtime: options.runtime,
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
        manifest,
        platformOptions,
        flags: { image: flags.image, prebuilt: flags.prebuilt },
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
