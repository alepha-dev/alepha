import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Miniflare } from "miniflare";
import { build } from "vite";
import { describe, expect, it } from "vitest";

describe("native actor workerd persistence", () => {
  it("recovers disk state after a full runtime restart, isolates instances and avoids recursive app startup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alepha-actor-"));
    // Resolve framework imports from this workspace while emitting outside the source tree.
    const entry = join(process.cwd(), "node_modules/.alepha/actor-runtime.ts");
    await mkdir(join(process.cwd(), "node_modules/.alepha"), {
      recursive: true,
    });
    await writeFile(
      entry,
      `
import { $atom, $hook, Alepha, AlephaError, run, z } from "alepha";
import { $actor, ActorCodec, ActorHostRuntime, AlephaActorDurableObject } from "alepha/actor";
class App {
 counter = $actor({ atom: $atom({ name: "counter", schema: z.integer(), default: 0 }), methods: { add: (s, n = 1) => s+n, fail: () => { throw new AlephaError("refused"); }, invalid: () => 0.5 } });
 session = $actor({ atom: $atom({ name: "nested", schema: z.object({ names: z.array(z.text()) }), default: { names: [] } }), methods: { append: (s, name) => ({ names: [...s.names, name] }) } });
 start = $hook({ on: "start", handler: () => this.counter.get("startup").add(10) });
}
const app = run(Alepha.create().with(App));
export { AlephaActorDurableObject };
export default { async fetch(request, env) {
 ActorHostRuntime.resolve(env);
 const input = await request.json();
 try {
  if (input.raw) {
   const identity = app.inject(ActorCodec).identity(env.ALEPHA_ACTOR_NAMESPACE, input.name ?? "counter", input.key);
   const stub = env.ALEPHA_ACTOR.get(env.ALEPHA_ACTOR.idFromName(input.target ?? identity));
   return Response.json(await stub.executeActor(identity, { name: input.name ?? "counter", key: input.key, method: input.method, args: input.args ?? [] }));
  }
  if (input.start) { await app.start(); return Response.json(await app.inject(App).counter.get("startup").read()); }
  let actor = app.inject(App)[input.actor ?? "counter"]; if (input.key !== undefined) actor = actor.get(input.key);
  return Response.json(await (input.method ? actor[input.method](...(input.args ?? [])) : actor.read()));
 } catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
} };
`,
    );
    let runtime: Miniflare | undefined;
    let script = "";
    const boot = (namespace = "fixture") =>
      new Miniflare({
        port: 0,
        telemetry: { enabled: false },
        resourcePersistencePath: join(dir, "state"),
        workers: [
          {
            config: {
              name: "actor-fixture",
              compatibilityDate: "2026-10-01",
              compatibilityFlags: ["nodejs_compat"],
              manifest: {
                mainModule: "worker.js",
                modules: { "worker.js": { type: "esm", contents: script } },
              },
              env: {
                ALEPHA_ACTOR: {
                  type: "durable-object",
                  worker: "actor-fixture",
                  exportName: "AlephaActorDurableObject",
                },
                ALEPHA_ACTOR_NAMESPACE: { type: "json", value: namespace },
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
      script = await readFile(join(dir, "worker.js"), "utf8");
      runtime = boot();
      const call = async (input: unknown) => {
        const response = await runtime!.dispatchFetch("http://actor.test/", {
          method: "POST",
          body: JSON.stringify(input),
        });
        return { status: response.status, data: await response.json() };
      };
      expect((await call({})).data).toBe(0);
      const values = await Promise.all(
        Array.from({ length: 20 }, () => call({ method: "add" })),
      );
      expect(
        values.map((value) => value.data).sort((a: any, b: any) => a - b),
      ).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      expect((await call({ key: "default" })).data).toBe(0);
      expect((await call({ method: "fail" })).status).toBe(400);
      expect((await call({ method: "invalid" })).status).toBe(400);
      expect((await call({ raw: true, method: "toString" })).status).toBe(400);
      expect((await call({ raw: true, name: "missing" })).status).toBe(400);
      expect((await call({ raw: true, target: "wrong-instance" })).status).toBe(
        400,
      );
      expect((await call({})).data).toBe(20);
      expect(
        (await call({ actor: "session", method: "append", args: ["kept"] }))
          .data,
      ).toEqual({ names: ["kept"] });
      expect((await call({ start: true })).data).toBe(10);
      await runtime.dispose();
      runtime = boot();
      expect((await call({ raw: true, name: "missing" })).status).toBe(400);
      expect((await call({ raw: true, target: "wrong-instance" })).status).toBe(
        400,
      );
      expect((await call({})).data).toBe(20);
      expect((await call({ actor: "session" })).data).toEqual({
        names: ["kept"],
      });
      expect((await call({ method: "add" })).data).toBe(21);
      // A new namespace uses different state on the same persistent disk.
      await runtime.dispose();
      runtime = boot("other");
      expect((await call({})).data).toBe(0);
      const source = await readFile(join(dir, "worker.js"), "utf8");
      expect(source).not.toContain("NodeRedisProvider");
    } finally {
      await runtime?.dispose();
      await rm(dir, { recursive: true, force: true });
      await rm(entry, { force: true });
    }
  }, 60_000);
});
