import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { Ajv } from "ajv";
import { $atom, $hook, Alepha, AlephaError, z } from "alepha";
import { $actor, ActorHostRegistry } from "alepha/actor";
import { AlephaActorRedis } from "alepha/actor/redis";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { $channel, $room, $websocket, WebSocketHost } from "alepha/websocket";
import { describe, expect, it } from "vitest";

import { ActorHostCollection } from "../services/ActorHostCollection.ts";
import { DurableObjectConfig } from "../services/DurableObjectConfig.ts";
import { BuildCloudflareTask } from "../tasks/BuildCloudflareTask.ts";
import { BuildManifestTask } from "../tasks/BuildManifestTask.ts";
import { BuildServerTask } from "../tasks/BuildServerTask.ts";

class ActorApp {
  value = $actor({
    atom: $atom({ name: "build-counter", schema: z.integer(), default: 0 }),
    methods: { add: (state) => state + 1 },
  });
  start = $hook({
    on: "start",
    handler: () => {
      throw new AlephaError("Build must not start the app");
    },
  });
}
class SocketApp {
  channel = $channel({
    path: "/ws/socket",
    schema: { in: z.object({}), out: z.object({}) },
  });
  socket = $websocket({ channel: this.channel, handler: async () => {} });
}
class RoomApp {
  channel = $channel({
    path: "/ws/room",
    schema: { in: z.object({}), out: z.object({}) },
  });
  room = $room({ channel: this.channel, state: () => ({ count: 0 }) });
}
class NoHosts {
  channel = $channel({
    path: "/unused",
    schema: { in: z.object({}), out: z.object({}) },
  });
}
class CloudflareTask extends BuildCloudflareTask {
  generate = this.generateCloudflare.bind(this);
}
class ManifestTask extends BuildManifestTask {
  write = this.writeManifest.bind(this);
}
class ServerTask extends BuildServerTask {
  exportsFor(app: Alepha, runtime: string) {
    this.hosts = runtime === "workerd" ? this.hostCollection.collect(app) : [];
    return this.durableObjectReexport("server/" + runtime, "entry.js");
  }
}

describe("generic Durable Object build contracts", () => {
  it("collects without app startup or a Redis connection and validates actor/socket/room/combined/no-host configurations against pinned Wrangler", async () => {
    const schema = JSON.parse(
      readFileSync(
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
    const cli = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    const fs = cli.inject(MemoryFileSystemProvider);
    const task = cli.inject(CloudflareTask);
    const manifest = cli.inject(ManifestTask);
    const cases = [
      Alepha.create().with(ActorApp),
      Alepha.create().with(SocketApp),
      Alepha.create().with(RoomApp),
      Alepha.create().with(ActorApp).with(RoomApp),
      Alepha.create().with(NoHosts),
    ];
    const expected = [
      ["AlephaActorDurableObject"],
      ["AlephaWebSocketDurableObject"],
      ["AlephaWebSocketDurableObject"],
      ["AlephaActorDurableObject", "AlephaWebSocketDurableObject"],
      [],
    ];
    for (const [index, app] of cases.entries()) {
      const ctx = {
        root: "/fixture",
        alepha: app,
        options: { runtime: ["node", "bun", "workerd"] },
      } as any;
      const hosts = cli.inject(ActorHostCollection).collect(app);
      expect(hosts.map((host) => host.exportName)).toEqual(expected[index]);
      expect(app.isStarted()).toBe(false);
      await task.generate(ctx, "dist");
      const config = JSON.parse(
        fs.getFileContent("/fixture/dist/wrangler.jsonc")!,
      );
      expect(validate(config), JSON.stringify(validate.errors)).toBe(true);
      expect(config.migrations).toBeUndefined();
      for (const name of expected[index])
        expect(config.exports[name]).toEqual({
          type: "durable-object",
          storage: "sqlite",
        });
      await manifest.write(ctx, "dist");
      const artifact = JSON.parse(
        fs.getFileContent("/fixture/dist/manifest.json")!,
      );
      expect(artifact.cloudflare.durableObjects).toEqual(hosts);
      expect(artifact.resources.hasDurableObjects).toBe(hosts.length > 0);
      expect(artifact.runtimes.map((slice: any) => slice.runtime)).toEqual([
        "node",
        "bun",
        "workerd",
      ]);
      const before = fs.getFileContent("/fixture/dist/main.cloudflare.js");
      await task.generate(
        { ...ctx, alepha: undefined, manifest: artifact },
        "dist",
      );
      expect(fs.getFileContent("/fixture/dist/main.cloudflare.js")).toBe(
        before,
      );
      const server = cli.inject(ServerTask);
      expect(server.exportsFor(app, "node")).toBe("");
      expect(server.exportsFor(app, "bun")).toBe("");
      for (const name of expected[index])
        expect(server.exportsFor(app, "workerd")).toContain(name);
      expect(JSON.stringify(artifact.cloudflare.durableObjects)).not.toContain(
        "schema",
      );
      expect(JSON.stringify(artifact.cloudflare.durableObjects)).not.toContain(
        "methods",
      );
    }
    const redis = Alepha.create({
      env: { ALEPHA_ACTOR_NAMESPACE: "build-only" },
    })
      .with(AlephaActorRedis)
      .with(ActorApp);
    expect(cli.inject(ActorHostCollection).collect(redis)).toEqual([
      ActorHostRegistry.actor,
    ]);
    expect(redis.inject<any>("NodeActorRedisProvider").isReady).toBe(false);
    await redis.stop();
  });

  it("preserves backend identity and legacy history, appends only new hosts and is idempotent", () => {
    const config = Alepha.create().inject(DurableObjectConfig);
    const actor = ActorHostRegistry.actor;
    const socket = WebSocketHost.declaration;
    const compatible: any = {
      exports: {
        [socket.exportName]: { type: "durable-object", storage: "legacy-kv" },
      },
    };
    config.enhance(compatible, [socket, actor]);
    expect(compatible.exports[socket.exportName].storage).toBe("legacy-kv");
    const steps = [{ tag: "first", new_sqlite_classes: [socket.exportName] }];
    const legacy: any = { migrations: steps };
    config.enhance(legacy, [socket, actor]);
    expect(steps).toEqual([
      { tag: "first", new_sqlite_classes: [socket.exportName] },
    ]);
    expect(legacy.migrations).toEqual([
      ...steps,
      { tag: "alepha-hosts-v1", new_sqlite_classes: [actor.exportName] },
    ]);
    expect(legacy.exports).toBeUndefined();
    const before = JSON.stringify(legacy);
    config.enhance(legacy, [socket, actor]);
    expect(JSON.stringify(legacy)).toBe(before);
    config.enhance(compatible, []);
    expect(compatible.exports[socket.exportName].storage).toBe("legacy-kv");
  });

  it("refuses binding, lifecycle and mixed-flow conflicts before writing artifacts", async () => {
    const cli = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    const task = cli.inject(CloudflareTask);
    const fs = cli.inject(MemoryFileSystemProvider);
    for (const config of [
      {
        durable_objects: {
          bindings: [{ name: "ALEPHA_ACTOR", class_name: "Wrong" }],
        },
      },
      {
        durable_objects: {
          bindings: [
            {
              name: "ALEPHA_ACTOR",
              class_name: "AlephaActorDurableObject",
              script_name: "other",
            },
          ],
        },
      },
      {
        exports: {
          AlephaActorDurableObject: {
            type: "durable-object",
            state: "deleted",
          },
        },
      },
      {
        migrations: [
          { tag: "v1", new_sqlite_classes: ["AlephaActorDurableObject"] },
          { tag: "v2", deleted_classes: ["AlephaActorDurableObject"] },
        ],
      },
      {
        migrations: [],
        exports: {
          AlephaActorDurableObject: {
            type: "durable-object",
            storage: "sqlite",
          },
        },
      },
    ]) {
      await expect(
        task.generate(
          {
            root: "/conflict",
            alepha: Alepha.create().with(ActorApp),
            options: { cloudflare: { config } },
          } as any,
          "dist",
        ),
      ).rejects.toThrow();
      expect(fs.wasWritten("/conflict/dist/wrangler.jsonc")).toBe(false);
    }
    await fs.writeFile("/old/node_modules/wrangler/config-schema.json", "{}");
    await expect(
      task.generate(
        {
          root: "/old",
          alepha: Alepha.create().with(ActorApp),
          options: {},
        } as any,
        "dist",
      ),
    ).rejects.toThrow("Installed Wrangler");
    expect(fs.wasWritten("/old/dist/wrangler.jsonc")).toBe(false);
  });
});
