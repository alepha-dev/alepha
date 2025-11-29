import { readFile, unlink, writeFile } from "node:fs/promises";
import type { Plugin, UserConfig } from "vite";
import { boot } from "../helpers/boot.ts";
import { fileExists } from "../helpers/fileExists.ts";
import {
  type BuildClientOptions,
  buildClient,
  buildServer,
  copyAssets,
  type GenerateDockerOptions,
  generateCloudflare,
  generateDocker,
  generateSitemap,
  generateVercel,
  prerenderPages,
  type VercelConfig,
} from "../tasks/index.ts";

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
   * If true, the build will generate Cloudflare Workers configuration.
   *
   * @default false
   */
  cloudflare?: boolean;

  /**
   * If true, the build will be optimized for Docker deployment.
   * Additionally, it will generate a Dockerfile in the dist directory.
   */
  docker?: boolean | Omit<GenerateDockerOptions, "distDir">;

  /**
   * If true, build statistics will be printed after the build completes.
   */
  stats?: boolean;
}

/**
 * Build modes controlled by ALEPHA_BUILD_MODE environment variable:
 * - "cli": Skip plugin entirely, CLI handles all tasks
 * - "client": Only build client bundle
 * - "server": Only build server bundle
 * - undefined/other: Full build (default behavior)
 */
export type AlephaBuildMode = "cli" | "client" | "server";

/**
 * Alepha build plugin for Vite.
 *
 * This plugin orchestrates the complete build process:
 * 1. Build client (if index.html exists)
 * 2. Build server (SSR)
 * 3. Copy assets from packages
 * 4. Pre-render static pages (if enabled)
 * 5. Generate sitemap (if enabled)
 * 6. Generate deployment config (Vercel/Cloudflare/Docker)
 *
 * Build mode can be controlled via ALEPHA_BUILD_MODE env var for CLI integration.
 */
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
      const buildMode = process.env.ALEPHA_BUILD_MODE as
        | AlephaBuildMode
        | undefined;

      // CLI mode: plugin does nothing, CLI handles everything
      if (buildMode === "cli") {
        return;
      }

      // For now, we run two separate builds: one for the client and one for the server
      // We distinguish them using an environment variable
      if (!process.env.VITE_DOUBLE_BUILD_DONE) {
        rootConfig = config;
      }

      if (ctx.isSsrBuild || !process.env.VITE_DOUBLE_BUILD_DONE) {
        // Server build, so we don't need the public directory
        config.publicDir = false;
      } else {
        // Client build, so we need the public directory
        config.publicDir = "public";
      }
    },
    async buildStart() {
      const buildMode = process.env.ALEPHA_BUILD_MODE as
        | AlephaBuildMode
        | undefined;

      // CLI mode: skip entirely
      if (buildMode === "cli") {
        return;
      }

      if (process.env.VITE_DOUBLE_BUILD_DONE === "true") {
        return;
      }

      process.env.VITE_DOUBLE_BUILD_DONE = "true";

      const hasClient =
        options.client !== false && (await fileExists("index.html"));

      const buildClientOptions =
        typeof options.client === "object" ? options.client : {};

      const stats = options.stats ?? process.env.ALEPHA_BUILD_STATS === "true";

      // Client-only mode
      if (buildMode === "client") {
        if (hasClient) {
          await buildClient({
            ...buildClientOptions,
            config: rootConfig,
            dist: `${distDir}/${clientDir}`,
            stats,
          });
        }
        process.exit(0);
      }

      // Server-only mode
      if (buildMode === "server") {
        if (entry) {
          // Check if client was already built (template exists)
          let clientBuilt = false;
          try {
            await readFile(`${distDir}/${clientDir}/index.html`, "utf-8");
            clientBuilt = true;
          } catch {
            // No client build
          }

          await buildServer({
            config: {
              base: rootConfig.base || "",
            },
            entry,
            distDir,
            clientDir: clientBuilt ? clientDir : undefined,
            stats,
          });
        }
        process.exit(0);
      }

      // Full build mode (default)

      // Task 1: Build client
      if (hasClient) {
        await buildClient({
          ...buildClientOptions,
          config: rootConfig,
          dist: `${distDir}/${clientDir}`,
          stats,
        });
      }

      let template = "";
      if (hasClient) {
        // Load output index.html for template embedding
        template = await readFile(
          `${distDir}/${clientDir}/index.html`,
          "utf-8",
        );
      }

      // Task 2: Build server
      if (entry) {
        await buildServer({
          config: {
            base: rootConfig.base || "",
          },
          entry,
          distDir,
          clientDir: hasClient ? clientDir : undefined,
          stats,
        });

        // Server will handle index.html if both client & server are built
        if (hasClient && options.serverEntry !== false) {
          await unlink(`${distDir}/${clientDir}/index.html`);
        }

        // Task 3: Copy assets (swagger ui & others)
        await copyAssets({
          entry: `${distDir}/index.js`,
          distDir,
        });
      }

      // Task 4: Generate sitemap
      if (buildClientOptions.sitemap && entry) {
        await writeFile(
          `${distDir}/${clientDir}/sitemap.xml`,
          await generateSitemap({
            entry: `${distDir}/index.js`,
            baseUrl: buildClientOptions.sitemap.hostname,
          }),
        );
      }

      // Task 5: Pre-render static pages
      if (buildClientOptions.prerender && template) {
        await prerenderPages({
          dist: `${distDir}/${clientDir}`,
          entry: `${distDir}/index.js`,
          compress: buildClientOptions.precompress,
        });
      }

      // Task 6: Generate deployment configurations
      if (options.vercel) {
        const config =
          typeof options.vercel === "boolean" ? {} : options.vercel;
        await generateVercel({
          distDir,
          clientDir,
          config,
        });
      }

      if (options.cloudflare) {
        await generateCloudflare({
          distDir,
        });
      }

      if (options.docker) {
        const dockerOpts =
          typeof options.docker === "boolean" ? {} : options.docker;
        await generateDocker({
          distDir,
          ...dockerOpts,
        });
      }

      // Prevent the default build from running again
      process.exit(0);
    },
  };
}
