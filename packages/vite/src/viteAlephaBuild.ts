import { readFile, unlink, writeFile } from "node:fs/promises";
import { boot } from "@alepha/core";
import type { Plugin, UserConfig } from "vite";
import { type BuildClientOptions, buildClient } from "./helpers/buildClient.ts";
import { buildServer } from "./helpers/buildServer.ts";
import { copyAssets } from "./helpers/copyAssets.ts";
import { fileExists } from "./helpers/fileExists.ts";
import { prerender } from "./helpers/prerender.ts";
import { generateSitemap } from "./helpers/sitemap.ts";
import type { ViteAlephaBuildDockerOptions } from "./viteAlephaBuildDocker.ts";
import type { VercelConfig } from "./viteAlephaBuildVercel.ts";

export interface ViteAlephaBuildOptions {
  /**
   * Path to the entry file for the server build.
   * If empty, SSR build will be skipped.
   */
  serverEntry?: string | false;

  /**
   * Set false to skip the client build.
   * This is useful if you only want to build the server-side application.
   */
  client?: false | Partial<BuildClientOptions>;

  /**
   * If true, the build will be optimized for Vercel deployment.
   *
   * If `VERCEL_PROJECT_ID` and `VERCEL_ORG_ID` environment variables are set, .vercel will be generated with the correct configuration.
   *
   * @default false
   */
  vercel?: boolean | VercelConfig;

  /**
   * If true, the build will be optimized for Docker deployment.
   * Additionally, it will generate a Dockerfile in the dist directory.
   */
  docker?: boolean | ViteAlephaBuildDockerOptions;

  /**
   * If true, build statistics will be printed after the build completes.
   */
  stats?: boolean;
}

export async function viteAlephaBuild(
  options: ViteAlephaBuildOptions = {},
): Promise<Plugin> {
  const entry = options.serverEntry ?? (await boot.getServerEntry());
  const distDir = "dist";
  const clientDir = "public";

  let rootConfig: UserConfig = {};

  return {
    name: "alepha-build",
    apply: "build",
    config(config, ctx) {
      // ---
      // for now, we run two separate builds: one for the client and one for the server
      // we distinguish them using an environment variable
      // ---

      if (!process.env.VITE_DOUBLE_BUILD_DONE) {
        rootConfig = config;
      }

      if (ctx.isSsrBuild || !process.env.VITE_DOUBLE_BUILD_DONE) {
        // server build, so we don't need the public directory
        config.publicDir = false;
      } else {
        // client build, so we need the public directory
        config.publicDir = "public";
      }
    },
    async buildStart() {
      if (process.env.VITE_DOUBLE_BUILD_DONE === "true") {
        return;
      }

      process.env.VITE_DOUBLE_BUILD_DONE = "true";

      const hasClient =
        options.client !== false && (await fileExists("index.html"));

      const buildClientOptions =
        typeof options.client === "object" ? options.client : {};

      if (hasClient) {
        // run vite build
        await buildClient({
          ...buildClientOptions,
          config: rootConfig,
          dist: `${distDir}/${clientDir}`,
          stats: options.stats ?? process.env.ALEPHA_BUILD_STATS === "true",
        });
      }

      let template = "";
      if (hasClient) {
        // load output index.html
        template = await readFile(
          `${distDir}/${clientDir}/index.html`,
          "utf-8",
        );
      }

      if (entry) {
        // run vite build ssr
        await buildServer({
          config: {
            base: rootConfig.base || "",
          },
          entry,
          distDir: `${distDir}`,
          clientDir: hasClient ? clientDir : undefined,
          vercel: options.vercel,
          docker: options.docker,
          stats: options.stats ?? process.env.ALEPHA_BUILD_STATS === "true",
        });

        // server will handle index.html if both client & server are built
        if (hasClient && options.serverEntry !== false) {
          await unlink(`${distDir}/${clientDir}/index.html`);
        }

        // copy swagger ui & others assets
        await copyAssets({
          entry: `${distDir}/index.js`,
          distDir: `${distDir}`,
        });
      }

      if (buildClientOptions.sitemap && entry) {
        // generate sitemap.xml
        await writeFile(
          `${distDir}/${clientDir}/sitemap.xml`,
          await generateSitemap({
            entry: `${distDir}/index.js`,
            baseUrl: buildClientOptions.sitemap.hostname,
          }),
        );
      }

      if (buildClientOptions.prerender && template) {
        // generate pre-rendered pages
        await prerender({
          template: template,
          dist: `${distDir}/${clientDir}`,
          entry: `${distDir}/index.js`,
          compress: buildClientOptions.precompress,
        });
      }

      // prevent the default build from running again
      process.exit(0);
    },
  };
}
