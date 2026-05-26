import { $inject, $state, Alepha, AlephaError, t } from "alepha";
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
import { BuildPrerenderTask } from "../tasks/BuildPrerenderTask.ts";
import { BuildPwaTask } from "../tasks/BuildPwaTask.ts";
import { BuildServerTask } from "../tasks/BuildServerTask.ts";
import { BuildSitemapTask } from "../tasks/BuildSitemapTask.ts";
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
    $inject(BuildSitemapTask),
    $inject(BuildPwaTask),
    $inject(BuildPrerenderTask),
    $inject(BuildVercelTask),
    $inject(BuildCloudflareTask),
    $inject(BuildDockerTask),
    $inject(BuildStaticTask),
    $inject(BuildCompressTask),
  ];

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
    flags: t.object({
      stats: t.optional(
        t.union([t.boolean(), t.enum(["json"])], {
          description: "Generate build stats report",
        }),
      ),
      target: t.optional(
        t.enum(["bare", "docker", "vercel", "cloudflare", "static"], {
          aliases: ["t"],
          description: "Deployment target",
        }),
      ),
      runtime: t.optional(
        t.enum(["node", "bun", "workerd"], {
          aliases: ["r"],
          description: "JavaScript runtime",
        }),
      ),
      image: t.optional(
        t.union([t.boolean(), t.text()], {
          aliases: ["i"],
          description:
            "Build Docker image. Use -i for latest, -i=<version> for specific version",
        }),
      ),
      compile: t.optional(
        t.boolean({
          aliases: ["c"],
          description:
            "Compile server to a single static binary (requires --target=docker --runtime=bun)",
        }),
      ),
      prebuilt: t.optional(
        t.boolean({
          description:
            "Skip the bundle steps (Vite client/server + asset compression). Only regenerates target-specific deploy config (e.g. wrangler.jsonc). Use when `dist/` is already built and you just need the config refreshed.",
        }),
      ),
      sitemap: t.optional(
        t.text({
          description: "Generate sitemap.xml with base URL",
        }),
      ),
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
      this.alepha.store.mut(buildOptions, (current) => ({
        ...current,
        stats: flags.stats ?? current.stats ?? false,
        target: flags.target ?? current.target,
        runtime: this.resolveRuntime(
          flags.target ?? current.target,
          flags.runtime ?? current.runtime,
        ),
        ...(flags.compile !== undefined && {
          docker: {
            ...current.docker,
            compile: flags.compile ? (current.docker?.compile ?? true) : false,
          },
        }),
        ...(flags.sitemap && {
          sitemap: { hostname: flags.sitemap },
        }),
      }));

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

      let appAlepha: Alepha | undefined;
      let hasClient = false;

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

      const ctx: BuildTaskContext = {
        alepha: appAlepha,
        options,
        root,
        run,
        entry,
        hasClient,
        flags: { image: flags.image, prebuilt: flags.prebuilt },
      };

      for (const task of this.pipeline) {
        await task.run(ctx);
      }
    },
  });
}
