import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { AlephaRedis, RedisProvider } from "../index.ts";
import { NodeRedisProvider } from "../providers/NodeRedisProvider.ts";

// The shared test env sets no REDIS_URL, so nothing else turns Redis on; this
// file runs against the compose `redis` service (16379, CI's port too). A
// test file runs in its own process, so this reaches no other file.
process.env.REDIS_URL ??= "redis://localhost:16379";

/**
 * Counts SCAN round-trips so pagination can be observed, not assumed.
 *
 * `keys(pattern)` walks the keyspace with SCAN and never with the blocking
 * `KEYS` command, which stalls every other client of a shared or large Redis
 * for a full keyspace walk: container flush, wildcard `invalidate("x*")` and
 * `clear()` all go through it.
 */
class Probe extends NodeRedisProvider {
  public static readonly pageSize = NodeRedisProvider.SCAN_COUNT;

  public pages = 0;

  protected override async scanPage(cursor: string, pattern: string) {
    this.pages++;
    return super.scanPage(cursor, pattern);
  }
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } }).with(
    AlephaRedis,
  );
  const redis = alepha.inject(RedisProvider);
  await alepha.start();
  return { alepha, redis };
};

describe("RedisProvider.keys", () => {
  it("finds every matching key across multiple SCAN pages", async () => {
    // Injected directly, for the reason given on the last test of this file.
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    const redis = alepha.inject(Probe);
    await alepha.start();
    const ns = `scan-${randomUUID()}`;

    // Three times the COUNT hint: these keys alone cannot fit in one page.
    const total = Probe.pageSize * 3;
    await Promise.all(
      Array.from({ length: total }, (_, i) =>
        redis.set(`${ns}:${i}`, String(i)),
      ),
    );

    const found = await redis.keys(`${ns}:*`);
    expect(found).toHaveLength(total);
    expect(new Set(found).size).toBe(total);
    expect(redis.pages).toBeGreaterThan(1);

    await redis.del(found);
    await alepha.stop();
  });

  it("returns an empty array when nothing matches", async () => {
    const { alepha, redis } = await setup();

    expect(await redis.keys(`missing-${randomUUID()}:*`)).toEqual([]);

    await alepha.stop();
  });

  it("does not match keys outside the pattern", async () => {
    const { alepha, redis } = await setup();
    const a = `scan-a-${randomUUID()}`;
    const b = `scan-b-${randomUUID()}`;

    await redis.set(`${a}:one`, "1");
    await redis.set(`${b}:one`, "1");

    const found = await redis.keys(`${a}:*`);
    expect(found).toEqual([`${a}:one`]);

    await redis.del([`${a}:one`, `${b}:one`]);
    await alepha.stop();
  });

  it("walks the keyspace with a cursor rather than one blocking call", async () => {
    // Injected directly rather than through `AlephaRedis`: the module
    // substitutes `RedisProvider -> NodeRedisProvider` itself, and a second
    // substitution on top of that is refused.
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    const redis = alepha.inject(Probe);
    await alepha.start();

    const ns = `scan-${randomUUID()}`;
    for (let i = 0; i < 50; i++) {
      await redis.set(`${ns}:${i}`, String(i));
    }

    const found = await redis.keys(`${ns}:*`);

    // At least one SCAN page was issued, and the cursor was followed to
    // completion (a `KEYS` implementation would issue zero).
    expect(redis.pages).toBeGreaterThan(0);
    expect(found).toHaveLength(50);

    await redis.del(found);
    await alepha.stop();
  });
});
