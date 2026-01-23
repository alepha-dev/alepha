import { $inject, $use, type Alepha, AlephaError, t } from "alepha";
import { $command } from "alepha/command";
import { FileSystemProvider } from "alepha/file";
import { $logger } from "alepha/logger";
import {
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
import { AppEntryProvider } from "../providers/AppEntryProvider.ts";
import { ViteBuildProvider } from "../providers/ViteBuildProvider.ts";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { PackageManagerUtils } from "../services/PackageManagerUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class BuildCommand {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);
  protected readonly boot = $inject(AppEntryProvider);
  protected readonly viteBuildProvider = $inject(ViteBuildProvider);
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

      await this.pm.ensureDependency(root, "vite", {
        run,
        exec: (cmd, opts) => this.utils.exec(cmd, opts),
      });
      await run.rm("dist", { alias: "clean dist" });

      const options = this.options;
      await this.utils.loadEnv(root, [".env", ".env.production"]);

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
          if (options.cloudflare) {
            conditions.push("workerd");
          }

          await buildServer({
            silent: true,
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

      // Generate deployment configurations
      if (flags.vercel || options.vercel) {
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
