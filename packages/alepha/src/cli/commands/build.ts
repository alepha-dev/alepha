import { $inject, $use, t } from "alepha";
import { $command } from "alepha/command";
import { FileSystemProvider } from "alepha/file";
import { $logger } from "alepha/logger";
import {
  boot,
  buildClient,
  buildServer,
  copyAssets,
  generateCloudflare,
  generateDocker,
  generateSitemap,
  generateVercel,
  prerenderPages,
} from "alepha/vite";
import { buildOptions } from "../atoms/buildOptions.ts";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { PackageManagerUtils } from "../services/PackageManagerUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class BuildCommand {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);
  protected readonly options = $use(buildOptions);

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
      vercel: t.optional(
        t.boolean({
          description: "Generate Vercel deployment configuration",
        }),
      ),
      cloudflare: t.optional(
        t.boolean({
          description: "Generate Cloudflare Workers configuration",
        }),
      ),
      docker: t.optional(
        t.boolean({
          description: "Generate Docker configuration",
        }),
      ),
      sitemap: t.optional(
        t.text({
          description: "Generate sitemap.xml with base URL",
        }),
      ),
      bun: t.optional(
        t.boolean({
          description: "Prioritize .bun.ts entry files for Bun runtime",
        }),
      ),
    }),
    handler: async ({ flags, run, root }) => {
      // Tell viteAlephaBuild plugin to skip - CLI handles all tasks
      process.env.ALEPHA_BUILD_MODE = "cli";
      process.env.NODE_ENV = "production";

      if (await this.pm.hasExpo(root)) {
        // will come soon
        return;
      }

      await this.scaffolder.ensureConfig(root, {
        tsconfigJson: true,
      });

      const entry = await boot.getServerEntry(root);
      this.log.trace("Entry file found", { entry });

      const distDir = "dist";
      const clientDir = "public";

      await this.pm.ensureDependency(root, "vite", {
        run,
        exec: (cmd, opts) => this.utils.exec(cmd, opts),
      });
      await run.rm("dist", { alias: "clean dist" });

      const options = this.options;
      await this.utils.loadEnv(root, [".env", ".env.production"]);

      const stats = flags.stats ?? options.stats ?? false;
      const hasClient = await this.fs.exists(this.fs.join(root, "index.html"));

      // Build client (precompress always enabled)
      if (hasClient) {
        await run({
          name: "vite build client",
          handler: () =>
            buildClient({
              silent: true,
              dist: `${distDir}/${clientDir}`,
              stats,
              precompress: true,
            }),
        });
      }

      // Build server
      await run({
        name: "vite build server",
        handler: async () => {
          const clientIndexPath = `${distDir}/${clientDir}/index.html`;
          const clientBuilt = await this.fs.exists(clientIndexPath);

          const conditions: string[] = [];

          // bun:
          // - alepha
          // - react-dom

          if (flags.bun) {
            conditions.push("bun");
          }

          // workerd:
          // - react-dom
          // - postgres

          // TODO: investigate if we have more conditions like 'edge' to add here
          if (options.cloudflare) {
            conditions.push("workerd");
          }

          await buildServer({
            silent: true,
            entry,
            distDir,
            clientDir: clientBuilt ? clientDir : undefined,
            stats,
            conditions,
          });

          // Server will handle index.html if both client & server are built
          if (clientBuilt) {
            await this.fs.rm(clientIndexPath);
          }
        },
      });

      // Copy assets
      await copyAssets({
        root,
        entry: `${distDir}/index.js`,
        distDir,
        run,
      });

      if (hasClient) {
        // Generate sitemap
        const sitemapHostname = flags.sitemap ?? options.sitemap?.hostname;
        if (sitemapHostname) {
          await run({
            name: "add sitemap",
            handler: async () => {
              await this.fs.writeFile(
                `${distDir}/${clientDir}/sitemap.xml`,
                await generateSitemap({
                  entry: `${distDir}/index.js`,
                  baseUrl: sitemapHostname,
                }),
              );
            },
          });
        }

        // Pre-render static pages (always enabled)
        await run({
          name: "pre-render pages",
          handler: async () => {
            await prerenderPages({
              dist: `${distDir}/${clientDir}`,
              entry: `${distDir}/index.js`,
              compress: true,
            });
          },
        });
      }

      // Generate deployment configurations
      if (flags.vercel || options.vercel) {
        await run({
          name: "add Vercel config",
          handler: () =>
            generateVercel({
              distDir,
              clientDir,
              config: options.vercel,
            }),
        });
      }

      if (flags.cloudflare || options.cloudflare) {
        await run({
          name: "add Cloudflare config",
          handler: () =>
            generateCloudflare({
              distDir,
              config: options.cloudflare?.config,
            }),
        });
      }

      if (flags.docker || options.docker) {
        await run({
          name: "add Docker config",
          handler: () =>
            generateDocker({
              distDir,
              ...options.docker,
            }),
        });
      }
    },
  });
}
