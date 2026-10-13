import { $hook, $atom, Alepha, AlephaError, z } from "alepha";
import {
  $actor,
  ActorCodec,
  ActorHost,
  ActorHostRegistry,
  ActorHostRuntime,
  type ActorStorage,
} from "alepha/actor";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";

import { CloudflareActorProvider } from "../providers/CloudflareActorProvider.ts";
class Expiring {
  value = $actor({
    atom: $atom({ name: "expiring", schema: z.integer(), default: 0 }),
    methods: { set: (_, until: number) => until },
    expiresAt: (state) => (state > 0 ? state : undefined),
  });
}
class App {
  value = $actor({
    atom: $atom({ name: "host", schema: z.integer(), default: 0 }),
    methods: {
      add: (state, n: number = 1) => state + n,
      fail: () => {
        throw new AlephaError("refused");
      },
    },
  });
}
class Storage implements ActorStorage {
  raw?: string;
  fail = false;
  async get<T>(): Promise<T | undefined> {
    return this.raw as T;
  }
  async put(_key: string, value: string) {
    if (this.fail) throw new AlephaError("disk failed");
    this.raw = value;
  }
}
describe("shared actor host runtime", () => {
  it("registers hosts in a Node application graph without starting it", () => {
    const app = Alepha.create().with(App);
    expect(app.inject(ActorHostRegistry).list()).toEqual([
      ActorHostRegistry.actor,
    ]);
    expect(app.isStarted()).toBe(false);
    const registry = app.inject(ActorHostRegistry);
    registry.register({ ...ActorHostRegistry.actor });
    expect(() =>
      registry.register({ ...ActorHostRegistry.actor, module: "other" }),
    ).toThrow("Conflicting");
    expect(() =>
      app.inject(ActorHostRuntime).namespace("ALEPHA_ACTOR"),
    ).toThrow("binding");
  });
  it("serializes dispatch, rejects mismatched identities and preserves state on failed writes", async () => {
    const previous = (globalThis as any).__alepha;
    const app = Alepha.create().with(App);
    (globalThis as any).__alepha = app;
    const identity = app.inject(ActorCodec).identity(app.name, "host");
    const env = {
      ALEPHA_ACTOR: {
        idFromName: (name: string) => ({ toString: () => name }),
        get: () => ({}),
      },
    };
    const storage = new Storage();
    const host = new ActorHost(storage, env, { toString: () => identity });
    try {
      expect(await host.execute(identity, { name: "host", args: [] })).toBe(0);
      // A read of a missing key stores nothing.
      expect(storage.raw).toBeUndefined();
      // Neither does a transition that leaves the default unchanged.
      expect(
        await host.execute(identity, {
          name: "host",
          method: "add",
          args: [0],
        }),
      ).toBe(0);
      expect(storage.raw).toBeUndefined();
      expect(
        await Promise.all(
          Array.from({ length: 20 }, () =>
            host.execute(identity, { name: "host", method: "add", args: [] }),
          ),
        ),
      ).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      await expect(
        host.execute(identity, { name: "host", method: "fail", args: [] }),
      ).rejects.toThrow();
      storage.fail = true;
      await expect(
        host.execute(identity, { name: "host", method: "add", args: [] }),
      ).rejects.toThrow("disk failed");
      storage.fail = false;
      expect(await host.execute(identity, { name: "host", args: [] })).toBe(20);
      await expect(
        host.execute(identity, { name: "host", method: "toString", args: [] }),
      ).rejects.toThrow("Unknown");
      await expect(
        host.execute(identity, { name: "host", key: "other", args: [] }),
      ).rejects.toThrow("identity mismatch");
      const unknown = app.inject(ActorCodec).identity(app.name, "missing");
      await expect(
        new ActorHost(storage, env, { toString: () => unknown }).execute(
          unknown,
          { name: "missing", args: [] },
        ),
      ).rejects.toThrow("Unknown actor");
      for (const raw of [
        "{",
        '{"version":2,"revision":0,"state":0}',
        '{"version":1,"revision":0,"state":0.5}',
      ]) {
        storage.raw = raw;
        await expect(
          host.execute(identity, { name: "host", args: [] }),
        ).rejects.toThrow();
        expect(storage.raw).toBe(raw);
      }
      expect(app.isStarted()).toBe(false);
    } finally {
      (globalThis as any).__alepha = previous;
    }
  });
  it("reads expired state as missing through the app's DateTimeProvider", async () => {
    const previous = (globalThis as any).__alepha;
    const app = Alepha.create().with(Expiring);
    (globalThis as any).__alepha = app;
    const identity = app.inject(ActorCodec).identity(app.name, "expiring");
    const env = {
      ALEPHA_ACTOR: {
        idFromName: (name: string) => ({ toString: () => name }),
        get: () => ({}),
      },
    };
    const storage = new Storage();
    const host = new ActorHost(storage, env, { toString: () => identity });
    const dateTime = app.inject(DateTimeProvider);
    dateTime.pause();
    try {
      const until = dateTime.nowMillis() + 1000;
      expect(
        await host.execute(identity, {
          name: "expiring",
          method: "set",
          args: [until],
        }),
      ).toBe(until);
      expect(JSON.parse(storage.raw!)).toMatchObject({
        version: 2,
        expiresAt: until,
      });
      await dateTime.travel(1000);
      expect(await host.execute(identity, { name: "expiring", args: [] })).toBe(
        0,
      );
    } finally {
      (globalThis as any).__alepha = previous;
    }
  });
  it("uses Alepha's pending startup, failure recovery and later restart semantics", async () => {
    class Starts {
      refused = true;
      ready = false;
      hook = $hook({
        on: "start",
        handler: async () => {
          await Promise.resolve();
          if (this.refused) throw new AlephaError("start refused");
          this.ready = true;
        },
      });
    }
    const app = Alepha.create().with(Starts);
    const runtime = app.inject(ActorHostRuntime);
    const service = app.inject(Starts);
    await expect(runtime.ensureStarted({})).rejects.toThrow("start refused");
    service.refused = false;
    const results = await Promise.all([
      runtime.ensureStarted({}),
      runtime.ensureStarted({}),
    ]);
    expect(results).toEqual([app, app]);
    expect(service.ready).toBe(true);
    await app.stop();
    service.ready = false;
    await runtime.ensureStarted({});
    expect(service.ready).toBe(true);
    await app.stop();
  });
  it("fails clearly on a missing Cloudflare binding rather than using Memory", async () => {
    const app = Alepha.create().with(App);
    const provider = app.inject(CloudflareActorProvider);
    await expect(provider.execute({ name: "host", args: [] })).rejects.toThrow(
      "ALEPHA_ACTOR",
    );
  });
});
