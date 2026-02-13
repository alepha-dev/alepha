import { $inject, $use, Alepha, AlephaError, t } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import {
  buildClient,
  buildServer,
  copyAssets,
  generateCloudflare,
  generateDocker,
  generateSitemap,
  generateStatic,
  generateVercel,
  prerenderPages,
} from "alepha/vite";
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
import { ViteUtils } from "../services/ViteUtils.ts";

export class BuildCommand {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);
  protected readonly boot = $inject(AppEntryProvider);
  protected readonly viteBuildProvider = $inject(ViteBuildProvider);
  protected readonly viteUtils = $inject(ViteUtils);
  protected readonly options = $use(buildOptions);

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
        t.boolean({
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

      const distDir = "dist";
      const publicDir = "public";

      await run.rm("dist", { alias: "clean dist" });

      const options = this.options;
      await this.utils.loadEnv(root, [".env", ".env.production"]);

      // Resolve target and runtime
      const target = flags.target ?? options.target;
      const runtime = this.resolveRuntime(
        target,
        flags.runtime ?? options.runtime,
      );

      // Validate --image requires --target=docker
      if (flags.image && target !== "docker") {
        throw new AlephaError(
          `Flag '--image' requires '--target=docker', got '${target ?? "bare"}'`,
        );
      }

      this.log.trace("Build configuration", { target, runtime });

      const stats = flags.stats ?? options.stats ?? false;
      let template = "";
      let hasClient = false;
      let alepha: Alepha | undefined;

      await run({
        name: "analyze app",
        handler: async () => {
          alepha = await this.viteBuildProvider.init({ entry });
          hasClient = this.viteBuildProvider.hasClient();
          if (hasClient) {
            template = this.viteBuildProvider.generateIndexHtml();
          }
        },
      });

      if (!alepha) {
        throw new AlephaError("Alepha instance not found");
      }

      // Build client (precompress always enabled)
      if (hasClient) {
        // TODO: find a way to avoid writing index.html to disk
        const indexHtmlPath = this.fs.join(root, "index.html");
        await this.fs.writeFile(indexHtmlPath, template);
        try {
          await run({
            name: "vite build client",
            handler: () =>
              buildClient({
                silent: true,
                dist: `${distDir}/${publicDir}`,
                stats,
                precompress: true,
              }),
          });
        } finally {
          await this.fs.rm(indexHtmlPath);
        }
      }

      // Build server
      await run({
        name: "vite build server",
        handler: async () => {
          if (!alepha) {
            throw new AlephaError("Alepha instance not found");
          }

          const clientIndexPath = `${distDir}/${publicDir}/index.html`;
          const clientBuilt = await this.fs.exists(clientIndexPath);

          // Set export conditions based on runtime
          const conditions: string[] = [];
          if (runtime === "bun") {
            conditions.push("bun");
          } else if (runtime === "workerd") {
            conditions.push("workerd");
          }

          await buildServer({
            silent: !this.alepha.isCI(),
            entry: entry.server,
            distDir,
            clientDir: clientBuilt ? publicDir : undefined,
            stats,
            conditions,
            alepha,
          });

          // Server will handle index.html if both client & server are built
          if (clientBuilt) {
            await this.fs.rm(clientIndexPath);
          }
        },
      });

      // Copy assets
      await copyAssets({
        alepha,
        root,
        entry: `${distDir}/index.js`,
        distDir,
        run,
      });

      if (hasClient) {
        // Generate sitemap
        const sitemapHostname = flags.sitemap ?? options.sitemap?.hostname;
        if (sitemapHostname) {
          await generateSitemap({
            alepha,
            baseUrl: sitemapHostname,
            output: `${distDir}/${publicDir}/sitemap.xml`,
            run,
          });
        }

        // Pre-render static pages (always enabled)
        await prerenderPages({
          alepha,
          dist: `${distDir}/${publicDir}`,
          compress: true,
          run,
        });
      }

      // Generate deployment configuration based on target
      if (target === "vercel") {
        await run({
          name: "add Vercel config",
          handler: () =>
            generateVercel({
              distDir,
              clientDir: publicDir,
              config: options.vercel,
            }),
        });
      }

      if (target === "cloudflare") {
        await run({
          name: "add Cloudflare config",
          handler: () =>
            generateCloudflare({
              distDir,
              config: options.cloudflare?.config,
              alepha: alepha!,
              importModule: (path) => this.viteUtils.importModule(path),
            }),
        });
      }

      if (target === "docker") {
        // Auto-configure Docker based on runtime
        const dockerFrom =
          options.docker?.from ??
          (runtime === "bun" ? "oven/bun:alpine" : "node:24-alpine");
        const dockerCommand =
          options.docker?.command ?? (runtime === "bun" ? "bun" : "node");

        await run({
          name: "add Docker config",
          handler: () =>
            generateDocker({
              distDir,
              image: dockerFrom,
              command: dockerCommand,
            }),
        });

        // Build Docker image if --image flag is provided
        if (flags.image) {
          const imageConfig = options.docker?.image;
          const flagValue =
            typeof flags.image === "string" ? flags.image : null;

          let imageTag: string;
          let version: string;

          if (!flagValue) {
            // -i (no value) → use config tag:latest
            if (!imageConfig?.tag) {
              throw new AlephaError(
                "Flag '--image' requires 'build.docker.image.tag' in config",
              );
            }
            version = "latest";
            imageTag = `${imageConfig.tag}:${version}`;
          } else if (flagValue.startsWith(":")) {
            // -i=:1.3.4 → version only, prepend config tag
            if (!imageConfig?.tag) {
              throw new AlephaError(
                "Flag '--image=:version' requires 'build.docker.image.tag' in config",
              );
            }
            version = flagValue.slice(1); // remove leading ":"
            imageTag = `${imageConfig.tag}:${version}`;
          } else if (flagValue.includes(":")) {
            // -i=toto:1.3.4 → full image with version
            imageTag = flagValue;
            version = flagValue.split(":")[1];
          } else {
            // -i=toto → image name without version → add :latest
            imageTag = `${flagValue}:latest`;
            version = "latest";
          }

          const args: string[] = [];

          // Add custom args
          if (imageConfig?.args) {
            args.push(imageConfig.args);
          }

          // Add OCI labels if enabled
          if (imageConfig?.oci) {
            const revision = await this.utils.getGitRevision();
            const created = new Date().toISOString();

            args.push(
              `--label "org.opencontainers.image.revision=${revision}"`,
            );
            args.push(`--label "org.opencontainers.image.created=${created}"`);
            args.push(`--label "org.opencontainers.image.version=${version}"`);
          }

          const argsStr = args.length > 0 ? `${args.join(" ")} ` : "";
          const dockerCmd = `docker build ${argsStr}-t ${imageTag} ${distDir}`;

          await run(dockerCmd, {
            alias: `docker build ${imageTag}`,
          });
        }
      }

      if (target === "static") {
        await generateStatic({
          alepha: alepha!,
          distDir,
          clientDir: publicDir,
          compress: true,
          domain: options.static?.domain,
          root,
          run,
        });
      }
    },
  });
}
