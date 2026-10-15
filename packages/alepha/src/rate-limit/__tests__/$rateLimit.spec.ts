import { randomUUID } from "node:crypto";

import { Alepha, AlephaError } from "alepha";
import {
  ActorContentionError,
  ActorProvider,
  ActorRedisConnection,
  type ActorRequest,
  MemoryActorProvider,
} from "alepha/actor";
import { $rateLimit, AlephaRateLimit } from "alepha/rate-limit";
import { describe, it } from "vitest";

import { Limits, RateLimitCases } from "./RateLimitCases.ts";

class InspectMemory extends MemoryActorProvider {
  public raw(identity: string): string | undefined {
    return this.snapshots.get(identity);
  }
}

class BrokenActorProvider extends ActorProvider {
  public error: Error = new AlephaError("actor store down");
  public calls: ActorRequest[] = [];
  public override async execute(request: ActorRequest): Promise<unknown> {
    this.calls.push(request);
    throw this.error;
  }
}

class Modes {
  deny = $rateLimit({ name: "mode:deny", limit: 1, window: 1000 });
  allow = $rateLimit({
    name: "mode:allow",
    limit: 1,
    window: 1000,
    onStoreError: "allow",
    onContention: "allow",
  });
}

describe("$rateLimit on Memory", () => {
  it("counts fixed windows, refunds, saturates and follows the limit", async ({
    expect,
  }) => {
    await RateLimitCases.run(
      {
        boot: async () => {
          const alepha = Alepha.create()
            .with({ provide: MemoryActorProvider, use: InspectMemory })
            .with(AlephaRateLimit)
            .with(Limits);
          await alepha.start();
          return alepha;
        },
        raw: async (alepha, identity) =>
          alepha.inject(InspectMemory).raw(identity),
      },
      expect,
    );
  });

  it("denies on store errors and contention by default, and emits the refusal", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with({
      provide: ActorProvider,
      use: BrokenActorProvider,
    });
    const modes = alepha.inject(Modes);
    const broken = alepha.inject(BrokenActorProvider);
    const denied: unknown[] = [];
    alepha.events.on("rateLimit:consume:denied", (event) => {
      denied.push(event);
    });
    await alepha.start();

    expect(await modes.deny.consume("x")).toEqual({
      allowed: false,
      reason: "store",
      limit: 1,
    });
    broken.error = new ActorContentionError("contended");
    expect(await modes.deny.consume("x")).toEqual({
      allowed: false,
      reason: "contention",
      limit: 1,
    });
    expect(denied).toEqual([
      { name: "mode:deny", key: "x", reason: "store" },
      { name: "mode:deny", key: "x", reason: "contention" },
    ]);
  });

  it("allows uncounted, with no ticket, under allow", async ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: ActorProvider,
      use: BrokenActorProvider,
    });
    const modes = alepha.inject(Modes);
    const broken = alepha.inject(BrokenActorProvider);
    await alepha.start();

    const result = await modes.allow.consume("x");
    expect(result).toEqual({ allowed: true, reason: "store", limit: 1 });
    expect(result.ticket).toBeUndefined();
    broken.error = new ActorContentionError("contended");
    expect(await modes.allow.consume("x")).toEqual({
      allowed: true,
      reason: "contention",
      limit: 1,
    });
  });

  it("never throws from refund, even with the store down", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with({
      provide: ActorProvider,
      use: BrokenActorProvider,
    });
    const modes = alepha.inject(Modes);
    await alepha.start();
    await expect(
      modes.deny.refund({
        name: "mode:deny",
        key: "x",
        resetAt: 1,
        limit: 1,
      }),
    ).resolves.toBeUndefined();
    // A ticket from another limiter is refused without throwing either.
    await expect(
      modes.deny.refund({ name: "mode:allow", key: "x", resetAt: 1, limit: 1 }),
    ).resolves.toBeUndefined();
    expect(alepha.inject(BrokenActorProvider).calls).toHaveLength(1);
  });

  it("refuses misconfiguration at declaration and at consume", async ({
    expect,
  }) => {
    class Duplicate {
      a = $rateLimit({ name: "dup", limit: 1, window: 1000 });
      b = $rateLimit({ name: "dup", limit: 1, window: 1000 });
    }
    class Sliding {
      a = $rateLimit({
        name: "sliding",
        limit: 1,
        window: 1000,
        algorithm: "sliding" as any,
      });
    }
    class Untyped {
      a = $rateLimit<{ id: string }>({ name: "untyped", limit: 1, window: 1 });
      b = $rateLimit({ name: "negative", limit: -1, window: 1000 });
      c = $rateLimit({ name: "zero", limit: 1, window: 0 });
    }
    expect(() => Alepha.create().inject(Duplicate)).toThrow(
      "Duplicate rate limiter",
    );
    expect(() => Alepha.create().inject(Sliding)).toThrow("fixed");
    const untyped = Alepha.create().inject(Untyped);
    await expect(untyped.a.consume({ id: "x" })).rejects.toThrow("key");
    await expect(untyped.b.consume("x")).rejects.toThrow("limit");
    await expect(untyped.c.consume("x")).rejects.toThrow("window");
  });

  it("allows zero hits with limit 0", async ({ expect }) => {
    class Closed {
      gate = $rateLimit({ name: "closed", limit: 0, window: 1000 });
    }
    const closed = Alepha.create().inject(Closed);
    expect(await closed.gate.consume("x")).toMatchObject({
      allowed: false,
      reason: "limit",
      count: 1,
    });
  });
});

describe("$rateLimit on Redis", () => {
  it("counts fixed windows, refunds, saturates and follows the limit", async ({
    expect,
  }) => {
    const name = `rate-limit-${randomUUID()}`;
    const apps: Alepha[] = [];
    try {
      await RateLimitCases.run(
        {
          boot: async () => {
            const alepha = Alepha.create({
              env: {
                APP_NAME: name,
                REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:16379",
              },
            })
              .with(AlephaRateLimit)
              .with(Limits);
            await alepha.start();
            // Each case starts from empty counters.
            const redis = alepha.inject(ActorRedisConnection);
            const keys = await redis.keys(`*${name}*`);
            if (keys.length) await redis.del(keys);
            apps.push(alepha);
            return alepha;
          },
          raw: async (alepha, identity) =>
            (await alepha.inject(ActorRedisConnection).get(identity))?.toString(
              "utf8",
            ),
        },
        expect,
      );
    } finally {
      const redis = apps[0]?.inject(ActorRedisConnection);
      const keys = (await redis?.keys(`*${name}*`)) ?? [];
      if (keys.length) await redis!.del(keys);
      await Promise.all(apps.map((alepha) => alepha.stop()));
    }
  });
});
