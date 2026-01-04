import { access, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { $inject, OPTIONS, t } from "alepha";
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
import type * as Vite from "vite";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";

export class BuildCommand {
  protected readonly log = $logger();
  protected readonly utils = $inject(AlephaCliUtils);

  public readonly build = $command({
    name: "build",
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
    }),
    handler: async ({ flags, args, run, root }) => {
      // Tell viteAlephaBuild plugin to skip - CLI handles all tasks
      process.env.ALEPHA_BUILD_MODE = "cli";
      process.env.NODE_ENV = "production";

      if (await this.utils.hasExpo(root)) {
        // will coming soon
        // 1. ensure "expo prebuild" is run
        return;
      }

      await this.utils.ensureConfig(root, {
        viteConfigTs: true,
        tsconfigJson: true,
      });

      const entry = await boot.getServerEntry(root, args);
      this.log.trace("Entry file found", { entry });

      const distDir = "dist";
      const clientDir = "public";

      await this.utils.ensureDependency(root, "vite", {
        run,
      });

      await run.rm("dist", {
        alias: "clean dist",
      });

      const vite: typeof Vite = createRequire(import.meta.url)("vite");
      const config = await vite.resolveConfig({}, "build", "production");
      const alephaPlugin: any = config.plugins.find(
        (it) => it.name === "alepha:build",
      );
      const viteAlephaBuildOptions = alephaPlugin?.[OPTIONS] || {};

      await this.utils.loadEnv(root, [".env", ".env.production"]);

      const stats = flags.stats ?? viteAlephaBuildOptions.stats ?? false;
      const hasServer = viteAlephaBuildOptions.serverEntry !== false;

      let hasClient = false;
      try {
        await access(join(root, "index.html"));
        hasClient = true;
      } catch {
        // No index.html
      }

      // Extract client options
      const clientOptions =
        typeof viteAlephaBuildOptions.client === "object"
          ? viteAlephaBuildOptions.client
          : {};

      // Build client
      if (hasClient) {
        await run({
          name: "vite build client",
          handler: () =>
            buildClient({
              silent: true,
              dist: `${distDir}/${clientDir}`,
              stats,
              precompress: clientOptions.precompress,
            }),
        });
      }

      // Build server
      await run({
        name: "vite build server",
        handler: async () => {
          // Check if client template exists
          let clientBuilt = false;
          try {
            await readFile(`${distDir}/${clientDir}/index.html`, "utf-8");
            clientBuilt = true;
          } catch {
            // No client build
          }

          await buildServer({
            silent: true,
            entry,
            distDir,
            clientDir: clientBuilt ? clientDir : undefined,
            stats,
          });

          // Server will handle index.html if both client & server are built
          if (clientBuilt && hasServer) {
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
        const sitemapBaseUrl = flags.sitemap ?? clientOptions.sitemap?.hostname;

        if (sitemapBaseUrl) {
          await run({
            name: "add sitemap",
            handler: async () => {
              await writeFile(
                `${distDir}/${clientDir}/sitemap.xml`,
                await generateSitemap({
                  entry: `${distDir}/index.js`,
                  baseUrl: sitemapBaseUrl,
                }),
              );
            },
          });
        }

        // Pre-render static pages
        const shouldPrerender = clientOptions.prerender;

        if (shouldPrerender) {
          await run({
            name: "pre-render pages",
            handler: async () => {
              await prerenderPages({
                dist: `${distDir}/${clientDir}`,
                entry: `${distDir}/index.js`,
                compress: clientOptions.precompress,
              });
            },
          });
        }
      }

      // Generate deployment configurations
      if (flags.vercel || viteAlephaBuildOptions.vercel) {
        const config =
          typeof viteAlephaBuildOptions.vercel === "object"
            ? viteAlephaBuildOptions.vercel
            : {};
        await run({
          name: "add Vercel config",
          handler: () =>
            generateVercel({
              distDir,
              clientDir,
              config,
            }),
        });
      }

      if (flags.cloudflare || viteAlephaBuildOptions.cloudflare) {
        const config =
          typeof viteAlephaBuildOptions.cloudflare === "boolean"
            ? {}
            : viteAlephaBuildOptions.cloudflare;
        await run({
          name: "add Cloudflare config",
          handler: () =>
            generateCloudflare({
              distDir,
              config,
            }),
        });
      }

      if (flags.docker || viteAlephaBuildOptions.docker) {
        const dockerConfig =
          typeof viteAlephaBuildOptions.docker === "object"
            ? viteAlephaBuildOptions.docker
            : {};
        await run({
          name: "add Docker config",
          handler: () =>
            generateDocker({
              distDir,
              ...dockerConfig,
            }),
        });
      }
    },
  });
}
