import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Miniflare } from "miniflare";
import { build } from "vite";
import { describe, it } from "vitest";

describe("$rateLimit on workerd", () => {
  it("consumes and refunds through the Durable Object, which resolves the shared declaration", async ({
    expect,
  }) => {
    const dir = await mkdtemp(join(tmpdir(), "alepha-rate-limit-"));
    const entry = join(
      process.cwd(),
      "node_modules/.alepha/rate-limit-runtime.ts",
    );
    await mkdir(join(process.cwd(), "node_modules/.alepha"), {
      recursive: true,
    });
    await writeFile(
      entry,
      `
import { Alepha, run } from "alepha";
import { ActorHostRuntime, AlephaActorDurableObject } from "alepha/actor";
import { $rateLimit } from "alepha/rate-limit";
class App {
 login = $rateLimit({ name: "fixture:login", limit: 2, window: 60_000 });
}
const app = run(Alepha.create().with(App));
export { AlephaActorDurableObject };
export default { async fetch(request, env) {
 ActorHostRuntime.resolve(env);
 const input = await request.json();
 const limits = app.inject(App);
 if (input.refund) { await limits.login.refund(input.refund); return Response.json(null); }
 return Response.json(await limits.login.consume(input.key));
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
              name: "rate-limit-fixture",
              compatibilityDate: "2026-10-01",
              compatibilityFlags: ["nodejs_compat"],
              manifest: {
                mainModule: "worker.js",
                modules: { "worker.js": { type: "esm", contents: script } },
              },
              env: {
                ALEPHA_ACTOR: {
                  type: "durable-object",
                  worker: "rate-limit-fixture",
                  exportName: "AlephaActorDurableObject",
                },
                APP_NAME: { type: "json", value: "rate-limit-fixture" },
              },
              exports: {
                AlephaActorDurableObject: {
                  type: "durable-object",
                  storage: "sqlite",
                },
              },
            },
          },
        ],
      });
      const call = async (input: unknown) => {
        const response = await runtime!.dispatchFetch("http://limit.test/", {
          method: "POST",
          body: JSON.stringify(input),
        });
        expect(response.status).toBe(200);
        return (await response.json()) as any;
      };
      const first = await call({ key: "ip:1" });
      expect(first).toMatchObject({ allowed: true, count: 1, limit: 2 });
      expect(await call({ key: "ip:1" })).toMatchObject({ count: 2 });
      expect(await call({ key: "ip:1" })).toMatchObject({
        allowed: false,
        reason: "limit",
        count: 3,
      });
      await call({ refund: first.ticket });
      expect(await call({ key: "ip:1" })).toMatchObject({
        allowed: true,
        count: 2,
      });
      expect(await call({ key: "ip:2" })).toMatchObject({ count: 1 });
    } finally {
      await runtime?.dispose();
      await rm(dir, { recursive: true, force: true });
      await rm(entry, { force: true });
    }
  }, 60_000);
});
