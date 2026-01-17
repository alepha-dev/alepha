import { access, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $inject, $use, t } from "alepha";
import { $command } from "alepha/command";
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

export class BuildCommand {
  protected readonly log = $logger();
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly options = $use(buildOptions);

  public readonly build = $command({
    name: "build",
    mode: "production",
    description: "Build the project for production",
    args: t.optional(
      t.text({ title: "path", description: "Filepath to build" }),
    ),
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
    handler: async ({ flags, args, run, root }) => {
      // Tell viteAlephaBuild plugin to skip - CLI handles all tasks
      process.env.ALEPHA_BUILD_MODE = "cli";
      process.env.NODE_ENV = "production";

      if (await this.utils.hasExpo(root)) {
        // will come soon
        return;
      }

      await this.utils.ensureConfig(root, {
        tsconfigJson: true,
      });

      const entry = await boot.getServerEntry(root, args);
      this.log.trace("Entry file found", { entry });

      const distDir = "dist";
      const clientDir = "public";

      await this.utils.ensureDependency(root, "vite", { run });
      await run.rm("dist", { alias: "clean dist" });

      const options = this.options;
      await this.utils.loadEnv(root, [".env", ".env.production"]);

      const stats = flags.stats ?? options.stats ?? false;

      let hasClient = false;
      try {
        await access(join(root, "index.html"));
        hasClient = true;
      } catch {
        // No index.html
      }

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
          let clientBuilt = false;
          try {
            await readFile(`${distDir}/${clientDir}/index.html`, "utf-8");
            clientBuilt = true;
          } catch {
            // No client build
          }

          const conditions: string[] = [];
          if (flags.bun) {
            conditions.push("bun");
          }

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
            await unlink(`${distDir}/${clientDir}/index.html`);
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
              await writeFile(
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
