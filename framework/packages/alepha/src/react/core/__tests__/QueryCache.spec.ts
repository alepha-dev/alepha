import { Alepha } from "alepha";
import { AlephaDateTime, DateTimeProvider } from "alepha/datetime";
import { describe, test } from "vitest";

import { QueryCache } from "../services/QueryCache.ts";
import { QueryWakeEvents } from "../services/QueryWakeEvents.ts";

const createCache = async () => {
  const alepha = Alepha.create().with(AlephaDateTime);
  const cache = alepha.inject(QueryCache);
  await alepha.start();
  return cache;
};

describe("QueryCache", () => {
  test("round-trips an entry by key", async ({ expect }) => {
    const cache = await createCache();

    cache.set(["folios", 1], { title: "Alpha" });

    expect(cache.get(["folios", 1])?.data).toEqual({ title: "Alpha" });
    expect(cache.get(["folios", 2])).toBe(undefined);
  });

  test("invalidates by key prefix", async ({ expect }) => {
    const cache = await createCache();

    cache.set(["folios", 1], { title: "Alpha" });
    cache.set(["folios", 2], { title: "Beta" });
    cache.set(["quests", 1], { title: "Gamma" });

    cache.invalidate(["folios"]);

    expect(cache.get(["folios", 1])).toBe(undefined);
    expect(cache.get(["folios", 2])).toBe(undefined);
    expect(cache.get(["quests", 1])?.data).toEqual({ title: "Gamma" });
  });

  test("does not let a prefix bleed into a longer sibling key", async ({
    expect,
  }) => {
    const cache = await createCache();

    cache.set(["folios"], "a");
    cache.set(["folios-archive"], "b");

    cache.invalidate(["folios"]);

    expect(cache.get(["folios"])).toBe(undefined);
    expect(cache.get(["folios-archive"])?.data).toBe("b");
  });

  test("treats object property order as insignificant", async ({ expect }) => {
    const cache = await createCache();

    cache.set(["folios", { page: 1, size: 10 }], "x");

    expect(cache.get(["folios", { size: 10, page: 1 }])?.data).toBe("x");
  });

  test("clears everything", async ({ expect }) => {
    const cache = await createCache();

    cache.set(["a"], 1);
    cache.set(["b"], 2);
    cache.clear();

    expect(cache.get(["a"])).toBe(undefined);
    expect(cache.get(["b"])).toBe(undefined);
  });

  test("never listens for a tab return or a reconnect on the server", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    const cache = alepha.inject(QueryCache);
    await alepha.start();

    const unobserve = cache.observe({
      key: ["k"],
      refetch: () => {},
      failed: () => false,
      options: () => ({ staleTime: 0 }),
    });

    expect(cache.observerCount(["k"])).toBe(1);
    expect(alepha.inject(QueryWakeEvents).listening()).toBe(false);
    unobserve();
    expect(cache.observerCount(["k"])).toBe(0);
  });

  test("creates no eviction timer on the server", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    const cache = alepha.inject(QueryCache);
    await alepha.start();
    const dateTime = alepha.inject(DateTimeProvider);

    cache.set(["k"], "v");
    const unobserve = cache.observe({
      key: ["j"],
      refetch: () => {},
      failed: () => false,
      options: () => ({ staleTime: 0 }),
    });
    unobserve();

    expect(
      (dateTime as unknown as { timeouts: unknown[] }).timeouts,
    ).toHaveLength(0);
  });

  test("dedupe never shares a request between two request contexts", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaDateTime);
    const cache = alepha.inject(QueryCache);
    await alepha.start();

    let calls = 0;
    const read = () =>
      cache.dedupe(["me"], async () => {
        const call = ++calls;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return call;
      });

    const [a, b] = await Promise.all([
      alepha.context.run(read),
      alepha.context.run(read),
    ]);
    expect(calls).toBe(2);
    expect(a).not.toBe(b);
  });
});
