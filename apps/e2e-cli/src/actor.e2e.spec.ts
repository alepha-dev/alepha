import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import { AlephaError } from "alepha";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ActorContract } from "../../../packages/alepha/src/actor/core/__tests__/ActorContract.ts";
import { e2ePort } from "../../../scripts/playwright.port.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const WORK = join(ROOT, ".e2e-tmp/actor");
const CONSUMER = join(WORK, "consumer");
const VARIANTS = {
  actor: [true, false, false],
  socket: [false, true, false],
  room: [false, false, true],
  combined: [true, true, true],
  none: [false, false, false],
  multi: [true, true, true],
} as const;

class Command {
  public static async run(
    command: string,
    args: string[],
    cwd: string,
  ): Promise<string> {
    return new Promise((resolveCommand, reject) => {
      const process = spawn(command, args, {
        cwd,
        shell: processPlatformShell(command),
        env: {
          ...globalThis.process.env,
          NODE_ENV: "development",
          LOG_LEVEL: "error",
          CLAUDECODE: "",
          YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
        },
      });
      let output = "";
      const timeout = setTimeout(() => {
        process.kill();
        reject(new AlephaError(`${command} timed out: ${output.slice(-4000)}`));
      }, 240_000);
      process.stdout?.on("data", (chunk) => {
        output += chunk;
      });
      process.stderr?.on("data", (chunk) => {
        output += chunk;
      });
      process.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      process.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolveCommand(output);
        else
          reject(
            new AlephaError(
              `${command} exited ${code}: ${output.slice(-8000)}`,
            ),
          );
      });
    });
  }
}
const processPlatformShell = (command: string) =>
  process.platform === "win32" && /\.(cmd|bat)$|^(npm|yarn)$/.test(command);

class SocketInbox {
  public readonly socket: any;
  protected readonly frames: any[] = [];
  protected pending?: { type: string; resolve: (value: any) => void };
  constructor(socket: any) {
    this.socket = socket;
    socket.addEventListener("message", (event: any) => {
      const frame = JSON.parse(event.data);
      if (this.pending?.type === frame.type) {
        const pending = this.pending;
        this.pending = undefined;
        pending.resolve(frame);
      } else this.frames.push(frame);
    });
    socket.accept();
  }
  public async next(type: string): Promise<any> {
    const index = this.frames.findIndex((frame) => frame.type === type);
    if (index !== -1) return this.frames.splice(index, 1)[0];
    return new Promise((resolveFrame, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(
          new AlephaError(
            `Missing socket frame '${type}', received ${JSON.stringify(this.frames)}`,
          ),
        );
      }, 20_000);
      this.pending = {
        type,
        resolve: (frame) => {
          clearTimeout(timer);
          resolveFrame(frame);
        },
      };
    });
  }
}

class RuntimeFixture {
  public runtime?: Miniflare;
  protected scope = "fixture";
  public readonly identity = (namespace: string, name: string, key?: string) =>
    JSON.stringify([
      "alepha.actor",
      1,
      namespace,
      name,
      key === undefined ? ["default"] : ["key", key],
    ]);
  public async boot(
    variant: keyof typeof VARIANTS,
    disk: string,
    namespace = "fixture",
    instrument = false,
  ): Promise<void> {
    this.scope = namespace;
    const dist = join(CONSUMER, variant, "dist");
    const config = JSON.parse(
      await readFile(join(dist, "wrangler.jsonc"), "utf8"),
    );
    const modules: Record<string, any> = {};
    const collect = async (directory: string, prefix = "") => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const name = prefix + entry.name;
        if (entry.isDirectory()) {
          if (name === "server" || name === "server/workerd")
            await collect(join(directory, entry.name), name + "/");
        } else if (
          name.endsWith(".js") &&
          (name === "main.cloudflare.js" ||
            name === "index.workerd.js" ||
            name.startsWith("server/workerd/"))
        )
          modules[name] = {
            type: "esm",
            contents: await readFile(join(directory, entry.name), "utf8"),
          };
      }
    };
    await collect(dist);
    if (instrument) {
      // Test-only storage/atom inspection around the actual packaged native host.
      // The production artifact is unchanged and exposes none of these RPCs.
      modules["main.cloudflare.js"].contents = modules[
        "main.cloudflare.js"
      ].contents.replace(
        'export { AlephaActorDurableObject } from "./index.workerd.js";',
        `import { AlephaActorDurableObject as NativeActor } from "./index.workerd.js";
export class AlephaActorDurableObject extends NativeActor {
 async inspect(action, value) {
  if (action === "put") { await this.ctx.storage.put("actor", value); return; }
  if (action === "raw") return this.ctx.storage.get("actor");
  const app = globalThis.__alepha;
  const atom = app.inject("ActorRegistry").get("contract.counter").atom;
  if (value !== undefined) app.store.set(atom, value);
  return app.store.get(atom);
 }
}`,
      );
    }
    const hostExports = Object.keys(config.exports ?? {}).join(", ");
    modules["fixture-control.js"] = {
      type: "esm",
      contents: `import main from "./main.cloudflare.js";
${hostExports ? `export { ${hostExports} } from "./main.cloudflare.js";` : ""}
export default { async fetch(request, env, context) {
 if (new URL(request.url).pathname !== "/__test/room") return main.fetch(request, env, context);
 const input = await request.json();
 const app = globalThis.__alepha;
 await app.inject("ActorHostRuntime").ensureStarted(env);
 const provider = app.inject("WebSocketServerProvider");
 const result = input.broadcast
  ? await provider.broadcastToRoom("/ws/world", "lobby", input.broadcast)
  : await provider.callRoom("/ws/world", "lobby", input.method, input.args ?? []);
 try { return Response.json({ value: result }); }
 finally { result?.[Symbol.dispose]?.(); }
} };`,
    };
    const worker = (name: string, scope: string) => {
      const env: Record<string, any> = {
        ALEPHA_ACTOR_NAMESPACE: { type: "json", value: scope },
        LOG_LEVEL: { type: "json", value: "error" },
      };
      for (const binding of config.durable_objects?.bindings ?? [])
        env[binding.name] = {
          type: "durable-object",
          worker: name,
          exportName: binding.class_name,
        };
      return {
        config: {
          name,
          compatibilityDate: config.compatibility_date,
          compatibilityFlags: config.compatibility_flags,
          manifest: { mainModule: "fixture-control.js", modules },
          env,
          exports: config.exports,
        },
      };
    };
    this.runtime = new Miniflare({
      port: e2ePort("actor-runtime"),
      telemetry: { enabled: false },
      resourcePersistencePath: disk,
      workers: [
        worker("fixture", namespace),
        worker("fixture-other", namespace + ":contract"),
      ],
    });
    await this.runtime.ready;
  }
  public async stop(): Promise<void> {
    await this.runtime?.dispose();
    this.runtime = undefined;
  }
  public async actor(
    name: string,
    method?: string,
    args: unknown[] = [],
    key?: string,
    other = false,
  ): Promise<any> {
    // Capture arguments before the first await, matching the public actor handle.
    const captured = structuredClone(args);
    const namespace = await this.runtime!.getDurableObjectNamespace(
      "ALEPHA_ACTOR",
      other ? "fixture-other" : "fixture",
    );
    const identity = this.identity(
      other ? this.scope + ":contract" : this.scope,
      name,
      key,
    );
    const stub = namespace.get(namespace.idFromName(identity)) as any;
    return JSON.parse(
      await stub.executeActor(identity, {
        name,
        method,
        args: captured,
        ...(key === undefined ? {} : { key }),
      }),
    );
  }
  public async inspect(action: string, value?: unknown): Promise<any> {
    const namespace = await this.runtime!.getDurableObjectNamespace(
      "ALEPHA_ACTOR",
      "fixture",
    );
    const identity = this.identity(
      "fixture",
      action === "local" ? "contract.counter" : "contract.corrupt",
    );
    return (namespace.get(namespace.idFromName(identity)) as any).inspect(
      action,
      value,
    );
  }
  public async room(
    method?: string,
    args: unknown[] = [],
    broadcast?: unknown,
  ): Promise<any> {
    const response = await this.runtime!.dispatchFetch(
      "http://fixture.test/__test/room",
      { method: "POST", body: JSON.stringify({ method, args, broadcast }) },
    );
    const data = (await response.json()) as any;
    if (!response.ok)
      throw new AlephaError(`Room RPC failed: ${JSON.stringify(data)}`);
    return data.value;
  }
  public async socket(path: string, accepted = true): Promise<any> {
    return this.runtime!.dispatchFetch(
      `http://fixture.test${path}?roomId=forged&hero=hero-42`,
      {
        headers: {
          Upgrade: "websocket",
          ...(accepted ? { Authorization: "Bearer accepted" } : {}),
          "x-alepha-ws-user-id": "forged",
          "x-alepha-ws-room-id": "forged",
        },
      },
    );
  }
}

describe("packaged actor and WebSocket runtime", () => {
  beforeAll(async () => {
    await readFile(join(ROOT, "packages/alepha/dist/core/index.js"));
    await rm(WORK, { recursive: true, force: true });
    await mkdir(CONSUMER, { recursive: true });
    const tarball = join(WORK, "alepha.tgz");
    await Command.run(
      "yarn",
      ["workspace", "alepha", "pack", "-o", tarball],
      ROOT,
    );
    await writeFile(
      join(CONSUMER, "package.json"),
      JSON.stringify({ name: "actor-consumer", private: true, type: "module" }),
    );
    await Command.run(
      "npm",
      ["install", "--no-audit", "--no-fund", tarball],
      CONSUMER,
    );
    const declarations = await readFile(
      join(ROOT, "packages/alepha/src/actor/core/__tests__/ContractActors.ts"),
      "utf8",
    );
    const template = await readFile(
      join(ROOT, "apps/e2e-cli/src/fixtures/actor/RealtimeFixture.ts.txt"),
      "utf8",
    );
    for (const [name, flags] of Object.entries(VARIANTS)) {
      const directory = join(CONSUMER, name);
      await mkdir(join(directory, "src"), { recursive: true });
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({
          name: `actor-${name}`,
          type: "module",
          private: true,
        }),
      );
      await writeFile(
        join(directory, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "Bundler",
            allowImportingTsExtensions: true,
            noEmit: true,
            strict: true,
          },
        }),
      );
      await writeFile(join(directory, "src/ContractActors.ts"), declarations);
      const realtime = template
        .replaceAll("__ACTOR__", String(flags[0]))
        .replaceAll("__SOCKET__", String(flags[1]))
        .replaceAll("__ROOM__", String(flags[2]));
      await writeFile(join(directory, "src/RealtimeFixture.ts"), realtime);
      await writeFile(
        join(directory, "src/main.server.ts"),
        `import { Alepha, run } from "alepha";
import { ContractActors } from "./ContractActors.ts";
import { RealtimeFixture } from "./RealtimeFixture.ts";
const app = Alepha.create();
${flags[0] ? "app.with(ContractActors);" : ""}
${flags[1] || flags[2] ? "app.with(RealtimeFixture);" : ""}
run(app);
`,
      );
      await Command.run(
        process.execPath,
        [
          join(CONSUMER, "node_modules/alepha/dist/bin/index.js"),
          "build",
          `--runtime=${name === "multi" ? "node,bun,workerd" : "workerd"}`,
        ],
        directory,
      );
    }
  }, 600_000);

  afterAll(async () => {
    await rm(WORK, { recursive: true, force: true });
  });

  it("builds all host combinations and preserves the ordered multi-runtime manifest", async () => {
    const schema = JSON.parse(
      await readFile(
        join(
          dirname(
            createRequire(import.meta.url).resolve("wrangler/package.json"),
          ),
          "config-schema.json",
        ),
        "utf8",
      ),
    );
    const validate = new Ajv({
      strict: false,
      allErrors: true,
      validateFormats: false,
    }).compile(schema);
    const installed = JSON.parse(
      await readFile(
        join(CONSUMER, "node_modules/alepha/package.json"),
        "utf8",
      ),
    );
    expect(installed.exports["./actor"].default).toContain("dist/");
    expect(installed.exports["./actor/redis"].default).toContain("dist/");
    for (const [name, [actor, socket, room]] of Object.entries(VARIANTS)) {
      const dist = join(CONSUMER, name, "dist");
      const manifest = JSON.parse(
        await readFile(join(dist, "manifest.json"), "utf8"),
      );
      const config = JSON.parse(
        await readFile(join(dist, "wrangler.jsonc"), "utf8"),
      );
      expect(validate(config), JSON.stringify(validate.errors)).toBe(true);
      const hosts = [
        ...(actor ? ["AlephaActorDurableObject"] : []),
        ...(socket || room ? ["AlephaWebSocketDurableObject"] : []),
      ];
      expect(
        manifest.cloudflare.durableObjects
          .map((host: any) => host.exportName)
          .sort(),
      ).toEqual(hosts.sort());
      expect(manifest.resources.hasDurableObjects).toBe(hosts.length > 0);
      expect(manifest.resources.hasWebSocket).toBe(socket || room);
      const entry = await readFile(join(dist, "main.cloudflare.js"), "utf8");
      for (const host of hosts) expect(entry).toContain(`export { ${host} }`);
      expect(config.migrations).toBeUndefined();
      if (name === "multi") {
        expect(manifest.runtimes.map((slice: any) => slice.runtime)).toEqual([
          "node",
          "bun",
          "workerd",
        ]);
        for (const runtime of ["node", "bun"]) {
          const source = await readFile(
            join(dist, `index.${runtime}.js`),
            "utf8",
          );
          expect(source).not.toContain("AlephaActorDurableObject");
          expect(source).not.toContain("AlephaWebSocketDurableObject");
          expect(source).not.toContain("cloudflare:workers");
        }
      }
    }
  });

  it("captures both published deployment transports from actual prebuilt artifacts", async () => {
    const script = await readFile(
      join(ROOT, "apps/e2e-cli/src/fixtures/actor/CaptureDeploy.mjs"),
      "utf8",
    );
    await writeFile(join(CONSUMER, "capture.mjs"), script);
    const output = await Command.run(
      process.execPath,
      ["capture.mjs"],
      CONSUMER,
    );
    const record = JSON.parse(output.trim().split("\n").at(-1)!);
    expect(record.uploads).toBe(2);
    expect(record.classes).toEqual([
      ["AlephaActorDurableObject"],
      ["AlephaActorDurableObject", "AlephaWebSocketDurableObject"],
    ]);
  });

  it("runs the shared semantic contract on real workerd and recovers disk state after full restart", async () => {
    const fixture = new RuntimeFixture();
    const disk = join(WORK, "actor-state");
    try {
      await fixture.boot("actor", disk, "fixture", true);
      await ActorContract.run({
        call: fixture.actor.bind(fixture),
        local: (value) => fixture.inspect("local", value),
        put: (raw) => fixture.inspect("put", raw),
        raw: () => fixture.inspect("raw"),
      });
      await fixture.stop();
      await fixture.boot("actor", disk);
      expect(await fixture.actor("contract.counter")).toBe(41);
      expect(await fixture.actor("contract.session")).toEqual({
        names: ["kept"],
        nested: { count: 1 },
      });
      expect(await fixture.actor("contract.counter", "add")).toBe(42);
      expect(
        await fixture.actor(
          "contract.counter",
          undefined,
          undefined,
          "default",
        ),
      ).toBe(3);
      await fixture.stop();
      // Same Worker/class and disk: these names would collide under delimiter concatenation.
      await fixture.boot("actor", disk, "fixture:contract");
      expect(await fixture.actor("actor:b", undefined, undefined, "c")).toBe(0);
      expect(await fixture.actor("contract.counter")).toBe(0);
    } finally {
      await fixture.stop();
    }
  });

  it("preserves admitted socket identities, frames, room RPC and actor state across native host eviction", async () => {
    const fixture = new RuntimeFixture();
    const clients: SocketInbox[] = [];
    try {
      await fixture.boot("combined", join(WORK, "combined-state"));
      expect((await fixture.socket("/ws/stateless", false)).status).toBe(401);
      const response = await fixture.socket("/ws/stateless");
      expect(response.status).toBe(101);
      const chat = new SocketInbox(response.webSocket);
      clients.push(chat);
      chat.socket.send(JSON.stringify({ type: "hello" }));
      expect(await chat.next("reply")).toMatchObject({
        type: "reply",
        count: 1,
      });
      expect(
        await fixture.actor("contract.counter", undefined, undefined, "socket"),
      ).toBe(1);

      const worldResponse = await fixture.socket("/ws/world");
      expect(worldResponse.status).toBe(101);
      const world = new SocketInbox(worldResponse.webSocket);
      clients.push(world);
      const joined = await world.next("joined");
      expect(joined).toMatchObject({
        userId: "fixture-user",
        hero: "hero-42",
        data: "{}",
      });
      world.socket.send(JSON.stringify({ type: "move" }));
      expect(await world.next("message")).toMatchObject({ count: 1 });
      const state = await fixture.room("inspect");
      expect(state.moves).toBe(1);
      expect(state.connections[0]).toMatchObject({
        id: joined.id,
        userId: "fixture-user",
        query: { hero: "hero-42", roomId: "forged" },
        data: { marker: "volatile" },
      });
      expect(await fixture.room("announce", ["rpc"])).toBe(1);
      expect(await world.next("broadcast")).toMatchObject({ word: "rpc" });
      await fixture.room(undefined, [], { type: "broadcast", word: "direct" });
      expect(await world.next("broadcast")).toMatchObject({ word: "direct" });

      await fixture.runtime!.unsafeEvictDurableObject(
        "fixture",
        "AlephaWebSocketDurableObject",
        { name: "/ws/world:lobby", webSockets: "hibernate" },
      );
      const reset = await fixture.room("inspect");
      expect(reset.moves).toBe(0);
      expect(reset.connections.length).toBe(0);
      world.socket.send(JSON.stringify({ type: "move" }));
      expect(await world.next("joined")).toMatchObject({
        id: joined.id,
        userId: "fixture-user",
        hero: "hero-42",
        data: "{}",
      });
      expect(await world.next("message")).toMatchObject({ count: 2 });
      expect(
        await fixture.actor("contract.counter", undefined, undefined, "room"),
      ).toBe(2);
      expect((await fixture.room("inspect")).moves).toBe(1);
      expect(await fixture.actor("contract.counter")).toBe(0);
    } finally {
      for (const client of clients) client.socket.close();
      await fixture.stop();
    }
  });
});
