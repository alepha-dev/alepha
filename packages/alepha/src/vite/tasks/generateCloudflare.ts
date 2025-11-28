import { writeFileSync } from "node:fs";
import { join } from "node:path";

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
  const dist = opts.distDir ?? "dist";
  const root = process.cwd();

  // Get current directory name for worker name
  const parts = root.split("/");
  const name = parts[parts.length - 1];

  const wrangler = {
    name: name,
    main: "./worker.js",
    compatibility_flags: ["nodejs_compat"],
    compatibility_date: "2025-11-17",
  };

  writeFileSync(
    join(root, dist, "wrangler.jsonc"),
    JSON.stringify(wrangler, null, 2),
  );

  const workerCode = `
process.env.ALEPHA_SERVERLESS = "true";

await import("./index.js");

export default {
  fetch: async (request, env, ctx) => {

    await __alepha.start();
    const ev = { req: request, res: undefined };
    await __alepha.events.emit("web:request", ev);
    return ev.res;
  },
};
`.trim();

  writeFileSync(
    join(root, dist, "worker.js"),
    `${WARNING_COMMENT}\n${workerCode}`.trim(),
  );
}
