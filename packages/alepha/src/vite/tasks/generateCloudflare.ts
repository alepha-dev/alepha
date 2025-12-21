import { access, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export interface GenerateCloudflareOptions {
  /**
   * The directory where the build output is placed.
   *
   * @default "dist"
   */
  distDir?: string;
}

const WARNING_COMMENT =
  "// This file was automatically generated. DO NOT MODIFY.\n" +
  "// Changes to this file will be lost when the code is regenerated.\n";

/**
 * Generate Cloudflare Workers deployment configuration.
 *
 * This task creates:
 * - wrangler.jsonc with worker configuration
 * - worker.js entry point for Cloudflare Workers
 */
export async function generateCloudflare(
  opts: GenerateCloudflareOptions = {},
): Promise<void> {
  const distDir = opts.distDir ?? "dist";
  const root = process.cwd();
  const name = basename(root);
  const hasAssets = await access(join(root, distDir, "public"))
    .then(() => true)
    .catch(() => false);

  await writeWranglerConfig(root, distDir, name, hasAssets);
  await writeWorkerEntryPoint(root, distDir);
}

/**
 * Write the wrangler.jsonc configuration file for Cloudflare Workers
 */
async function writeWranglerConfig(
  root: string,
  distDir: string,
  name: string,
  hasAssets: boolean,
): Promise<void> {
  const wrangler = {
    name,
    main: "./main.cloudflare.js",
    compatibility_flags: ["nodejs_compat"],
    compatibility_date: "2025-11-17",
    assets: hasAssets
      ? {
          directory: "./public",
          binding: "ASSETS",
        }
      : undefined,
  };

  await writeFile(
    join(root, distDir, "wrangler.jsonc"),
    JSON.stringify(wrangler, null, 2),
  );
}

/**
 * Write the worker entry point that bootstraps Alepha and handles fetch requests
 */
async function writeWorkerEntryPoint(
  root: string,
  distDir: string,
): Promise<void> {
  const workerCode = `
import "./index.js";

export default {
  fetch: async (request) => {
    const ctx = { req: request, res: undefined };

    await __alepha.start();
    await __alepha.events.emit("web:request", ctx);

    return ctx.res;
  },
};
`.trim();

  await writeFile(
    join(root, distDir, "main.cloudflare.js"),
    `${WARNING_COMMENT}\n${workerCode}`.trim(),
  );
}
