import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Miniflare } from "miniflare";
import { build } from "vite";
import { describe, it } from "vitest";

/**
 * A request's ambient signal on workerd (#E85).
 *
 * At the edge, `request.signal` aborts on a client disconnect under
 * `enable_request_signal`, the flag the Cloudflare build writes. Local workerd
 * never fires it: not through Miniflare's entry proxy, not on a direct socket,
 * at any compatibility date (probed with a bare worker and a raw TCP client
 * that destroys its socket, #Q2713). So this pins what can be observed here:
 * the handler's signal IS the incoming Request's own, and the context's, so
 * the edge's disconnect reaches every consumer without another hop.
 */
describe("ServerProvider request signal (workerd)", () => {
  it("hands the handler the Request's own signal, as the context's signal", async ({
    expect,
  }) => {
    const dir = await mkdtemp(join(tmpdir(), "alepha-request-signal-"));
    const entry = join(
      process.cwd(),
      "node_modules/.alepha/request-signal-runtime.ts",
    );
    await mkdir(join(process.cwd(), "node_modules/.alepha"), {
      recursive: true,
    });
    await writeFile(
      entry,
      `
import { $inject, Alepha, run } from "alepha";
import { $route } from "alepha/server";
class App {
 alepha = $inject(Alepha);
 probe = $route({
  path: "/probe",
  handler: ({ signal, raw }) => JSON.stringify({
   request: signal === raw.web?.req.signal,
   context: signal === this.alepha.context.signal,
   aborted: signal.aborted,
  }),
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
              name: "request-signal-fixture",
              // The build's own date and flags.
              compatibilityDate: "2025-11-17",
              compatibilityFlags: ["nodejs_compat", "enable_request_signal"],
              manifest: {
                mainModule: "worker.js",
                modules: { "worker.js": { type: "esm", contents: script } },
              },
            },
          },
        ],
      });

      const response = await runtime.dispatchFetch("http://signal.test/probe");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        request: true,
        context: true,
        aborted: false,
      });
    } finally {
      await runtime?.dispose();
      await rm(dir, { recursive: true, force: true });
      await rm(entry, { force: true });
    }
  }, 60_000);
});
