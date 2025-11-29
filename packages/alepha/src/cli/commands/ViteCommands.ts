import { access, readFile, unlink, writeFile } from "node:fs/promises";
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
  type ViteAlephaBuildOptions,
} from "alepha/vite";
import { ProcessRunner } from "../services/ProcessRunner.ts";
import { ProjectUtils } from "../services/ProjectUtils.ts";

export class ViteCommands {
  protected readonly log = $logger();
  protected readonly runner = $inject(ProcessRunner);
  protected readonly utils = $inject(ProjectUtils);

  public readonly run = $command({
    name: "run",
    description: "Run a TypeScript file directly",
    flags: t.object({
      watch: t.optional(
        t.boolean({ description: "Watch file for changes", alias: "w" }),
      ),
    }),
    summary: false,
    args: t.text({ title: "path", description: "Filepath to run" }),
    handler: async ({ args, flags, root }) => {
      await this.utils.ensureTsConfig(root);
      await this.runner.exec(`tsx ${flags.watch ? "watch " : ""}${args}`);
    },
  });

  /**
   * Will run the project in watch mode.
   *
   * - If an index.html file is found in the project root, it will run Vite in dev mode.
   * - Otherwise, it will look for a server entry file and run it with tsx in watch mode.
   */
  public readonly dev = $command({
    name: "dev",
    description: "Run the project in development mode",
    args: t.optional(t.text({ title: "path", description: "Filepath to run" })),
    handler: async ({ args, root }) => {
      await this.utils.ensureTsConfig(root);
      await this.utils.ensurePackageJsonModule(root);
      const entry = await boot.getServerEntry(root, args);
      this.log.trace("Entry file found", { entry });

      try {
        await access(join(root, "index.html"));
      } catch {
        this.log.trace("No index.html found, running entry file with tsx");
        await this.runner.exec(`tsx watch ${entry}`);
        return;
      }

      const configPath = await this.utils.getViteConfigPath(
        root,
        args ? entry : undefined,
      );
      this.log.trace("Vite config found", { configPath });
      await this.runner.exec(`vite -c=${configPath}`);
    },
  });

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
      prerender: t.optional(
        t.boolean({
          description: "Pre-render static pages",
        }),
      ),
    }),
    handler: async ({ flags, args, run }) => {
      // Tell viteAlephaBuild plugin to skip - CLI handles all tasks
      process.env.ALEPHA_BUILD_MODE = "cli";

      const root = process.cwd();
      await this.utils.ensureTsConfig(root);
      await this.utils.ensurePackageJsonModule(root);
      const entry = await boot.getServerEntry(root, args);
      this.log.trace("Entry file found", { entry });

      const distDir = "dist";
      const clientDir = "public";

      await run.rm("dist", {
        alias: "rm dist",
      });

      const viteConfig = await import(join(root, "vite.config.ts"));
      const viteAlephaBuildOptions: ViteAlephaBuildOptions =
        viteConfig?.default?.plugins.find((it: any) => !!it[OPTIONS])?.[
          OPTIONS
        ] ?? {};

      const stats = flags.stats ?? viteAlephaBuildOptions.stats ?? false;

      let hasClient = false;
      try {
        await access(join(root, "index.html"));
        hasClient = true;
      } catch {
        // No index.html
      }

      // Build client
      if (hasClient) {
        await run({
          name: "vite build client",
          handler: () =>
            buildClient({
              silent: true,
              dist: `${distDir}/${clientDir}`,
              stats,
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
          if (clientBuilt) {
            await unlink(`${distDir}/${clientDir}/index.html`);
          }
        },
      });

      // Copy assets
      await run({
        name: "cp assets",
        handler: () =>
          copyAssets({
            entry: `${distDir}/index.js`,
            distDir,
          }),
      });

      // Generate sitemap
      const sitemapBaseUrl =
        flags.sitemap ??
        (typeof viteAlephaBuildOptions.client === "object"
          ? viteAlephaBuildOptions.client.sitemap?.hostname
          : undefined);

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
      const shouldPrerender =
        flags.prerender ??
        (typeof viteAlephaBuildOptions.client === "object"
          ? viteAlephaBuildOptions.client.prerender
          : false);

      if (shouldPrerender && hasClient) {
        await run({
          name: "pre-render pages",
          handler: async () => {
            const template = await readFile(
              `${distDir}/${clientDir}/index.html`,
              "utf-8",
            ).catch(() => "");

            if (template) {
              await prerenderPages({
                template,
                dist: `${distDir}/${clientDir}`,
                entry: `${distDir}/index.js`,
              });
            }
          },
        });
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
        await run({
          name: "add Cloudflare config",
          handler: () =>
            generateCloudflare({
              distDir,
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

  public readonly test = $command({
    name: "test",
    description: "Run tests using Vitest",
    handler: async ({ root }) => {
      await this.utils.ensureTsConfig(root);
      const configPath = await this.utils.getViteConfigPath(root);
      await this.runner.exec(`vitest run -c=${configPath}`);
    },
  });
}
