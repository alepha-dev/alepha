import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Miniflare } from "miniflare";
import { build } from "vite";
import { describe, it } from "vitest";

/**
 * The tracing module on real workerd (#E86): the workerd barrel loads (its
 * `cloudflare:workers` read does not refuse the Worker), the tracer is
 * `WorkerdTracer`, and a request traced through it answers normally. Local
 * workerd records no traces, so the Cloudflare side of the mapping is the
 * node spec's (`WorkerdTracer.spec.ts`).
 */
describe("alepha/tracing on workerd", () => {
  it("selects WorkerdTracer and serves a traced request", async ({
    expect,
  }) => {
    const dir = await mkdtemp(join(tmpdir(), "alepha-tracing-workerd-"));
    const entry = join(
      process.cwd(),
      "node_modules/.alepha/tracing-workerd-runtime.ts",
    );
    await mkdir(join(process.cwd(), "node_modules/.alepha"), {
      recursive: true,
    });
    await writeFile(
      entry,
      `
import { $inject, Alepha, run } from "alepha";
import { $route } from "alepha/server";
import { Tracer, WorkerdTracer } from "alepha/tracing";
class App {
 tracer = $inject(Tracer);
 probe = $route({
  path: "/probe",
  handler: async () => {
   const inner = await this.tracer.span("inner", async () => "ran");
   return JSON.stringify({
    workerd: this.tracer instanceof WorkerdTracer,
    platform: typeof WorkerdTracer.platformTracing,
    traceparent: this.tracer.traceparent() ?? null,
    inner,
   });
  },
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
              name: "tracing-fixture",
              // The build's own date and flags.
              compatibilityDate: "2026-11-03",
              compatibilityFlags: ["nodejs_compat", "enable_request_signal"],
              manifest: {
                mainModule: "worker.js",
                modules: { "worker.js": { type: "esm", contents: script } },
              },
            },
          },
        ],
      });

      const response = await runtime.dispatchFetch(
        "http://tracing.test/probe",
        {
          headers: {
            traceparent:
              "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          },
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        workerd: true,
        platform: "object",
        traceparent: null,
        inner: "ran",
      });
    } finally {
      await runtime?.dispose();
      await rm(dir, { recursive: true, force: true });
      await rm(entry, { force: true });
    }
  }, 60_000);
});
