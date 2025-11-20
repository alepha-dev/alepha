import { writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ViteAlephaBuildCloudflareOptions {
  /**
   * The directory where the build output will be placed.
   *
   * @default "dist"
   */
  distDir?: string;

  /**
   * The name of the client directory.
   *
   * @default "public"
   */
  clientDir?: string;
}

export async function viteAlephaBuildCloudflare(
  opts: ViteAlephaBuildCloudflareOptions = {},
) {
  const dist = opts.distDir ?? "dist";
  const root = process.cwd();

  return {
    name: "alepha-cloudflare",
    apply: "build",
    writeBundle() {
      const warning =
        "// This file was automatically generated. DO NOT MODIFY." +
        "\n" +
        "// Changes to this file will be lost when the code is regenerated.\n";

      // get current directory name
      const parts = root.split("/");
      const name = parts[parts.length - 1];

      const wrangle = {
        name: name,
        main: "./worker.js",
        compatibility_flags: ["nodejs_compat"],
        compatibility_date: "2025-11-17",
      };

      writeFileSync(
        join(root, dist, "wrangler.jsonc"),
        JSON.stringify(wrangle, null, 2),
      );

      const main = `
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
        `${warning}\n${main}`.trim(),
      );
    },
  };
}
