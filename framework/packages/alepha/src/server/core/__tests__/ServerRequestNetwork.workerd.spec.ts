import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Miniflare } from "miniflare";
import { build } from "vite";
import { describe, it } from "vitest";

/**
 * The visitor's network on workerd: `request.geo.network` reads the Workers
 * request's `cf.asn` and `cf.asOrganization`, which Cloudflare sets on every
 * plan. Miniflare passes a `cf` object through `dispatchFetch`, which is how
 * the edge's values are stood in for here.
 */
describe("request.geo.network (workerd)", () => {
  it("exposes the autonomous system number and name from the request's cf object", async ({
    expect,
  }) => {
    const dir = await mkdtemp(join(tmpdir(), "alepha-request-network-"));
    const entry = join(
      process.cwd(),
      "node_modules/.alepha/request-network-runtime.ts",
    );
    await mkdir(join(process.cwd(), "node_modules/.alepha"), {
      recursive: true,
    });
    await writeFile(
      entry,
      `
import { Alepha, run } from "alepha";
import { $route } from "alepha/server";
class App {
 probe = $route({
  path: "/probe",
  handler: (request) => JSON.stringify({ network: request.geo.network ?? null }),
 });
}
const app = run(Alepha.create().with(App));
export default { async fetch(request) {
 await app.start();
 const ctx = { req: request };
 await app.events.emit("web:request:before", ctx);
 return ctx.res ?? new Response("no response", { status: 500 });
} };
`,
    );
    let runtime: Miniflare | undefined;
    try {
      await build({
        configFile: false,
        publicDir: false,
        logLevel: "silent",
        ssr: {
          noExternal: true,
          resolve: { conditions: ["workerd", "module"] },
        },
        build: {
          ssr: entry,
          outDir: dir,
          emptyOutDir: false,
          minify: false,
          rolldownOptions: {
            external: [/^cloudflare:/, /^node:/],
            output: {
              entryFileNames: "worker.js",
              codeSplitting: false,
              format: "esm",
            },
          },
        },
      });
      const script = await readFile(join(dir, "worker.js"), "utf8");
      runtime = new Miniflare({
        port: 0,
        telemetry: { enabled: false },
        workers: [
          {
            config: {
              name: "request-network-fixture",
              compatibilityDate: "2026-11-03",
              compatibilityFlags: ["nodejs_compat"],
              manifest: {
                mainModule: "worker.js",
                modules: { "worker.js": { type: "esm", contents: script } },
              },
            },
          },
        ],
      });

      const response = await runtime.dispatchFetch(
        "http://network.test/probe",
        {
          cf: { asn: 13335, asOrganization: "Cloudflare, Inc." },
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        network: { number: 13335, name: "Cloudflare, Inc." },
      });
    } finally {
      await runtime?.dispose();
      await rm(dir, { recursive: true, force: true });
      await rm(entry, { force: true });
    }
  }, 60_000);
});
