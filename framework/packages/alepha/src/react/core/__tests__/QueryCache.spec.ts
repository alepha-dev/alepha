import { Alepha } from "alepha";
import { AlephaDateTime, DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";

import { QueryCache } from "../services/QueryCache.ts";
import { QueryWakeEvents } from "../services/QueryWakeEvents.ts";

class TestDateTimeProvider extends DateTimeProvider {
  public pendingTimeouts() {
    return this.timeouts.length;
  }
}

const createCache = async () => {
  const alepha = Alepha.create().with(AlephaDateTime);
  const cache = alepha.inject(QueryCache);
  await alepha.start();
  return cache;
};

describe("QueryCache", () => {
  it("round-trips an entry by key", async ({ expect }) => {
    const cache = await createCache();

    cache.set(["folios", 1], { title: "Alpha" });

    expect(cache.get(["folios", 1])?.data).toEqual({ title: "Alpha" });
    expect(cache.get(["folios", 2])).toBe(undefined);
  });

  it("invalidates by key prefix", async ({ expect }) => {
    const cache = await createCache();

    cache.set(["folios", 1], { title: "Alpha" });
    cache.set(["folios", 2], { title: "Beta" });
    cache.set(["quests", 1], { title: "Gamma" });

    cache.invalidate(["folios"]);

    expect(cache.get(["folios", 1])).toBe(undefined);
    expect(cache.get(["folios", 2])).toBe(undefined);
    expect(cache.get(["quests", 1])?.data).toEqual({ title: "Gamma" });
  });

  it("does not let a prefix bleed into a longer sibling key", async ({
    expect,
  }) => {
    const cache = await createCache();

    cache.set(["folios"], "a");
    cache.set(["folios-archive"], "b");

    cache.invalidate(["folios"]);

    expect(cache.get(["folios"])).toBe(undefined);
    expect(cache.get(["folios-archive"])?.data).toBe("b");
  });

  it("treats object property order as insignificant", async ({ expect }) => {
    const cache = await createCache();

    cache.set(["folios", { page: 1, size: 10 }], "x");

    expect(cache.get(["folios", { size: 10, page: 1 }])?.data).toBe("x");
  });

  it("invalidates every entry on the empty prefix", async ({ expect }) => {
    const cache = await createCache();

    cache.set(["a"], 1);
    cache.set(["b", 2], 2);
    cache.set([], 3);

    cache.invalidate([]);

    expect(cache.get(["a"])).toBe(undefined);
    expect(cache.get(["b", 2])).toBe(undefined);
    expect(cache.get([])).toBe(undefined);
  });

  it("orders object properties by code unit, whatever the runtime's locale", async ({
    expect,
  }) => {
    const cache = await createCache();

    // A locale-aware comparison puts "a" before "B" in English, "zone" before
    // "take" in Estonian and "year" before "job" in Lithuanian, so a server
    // and a browser could disagree on the serialized key.
    expect(cache.serialize([{ a: 1, B: 2 }])).toBe('[{"B":2,"a":1}]');
    expect(cache.serialize([{ zone: "eu", take: 20 }])).toBe(
      '[{"take":20,"zone":"eu"}]',
    );
    expect(cache.serialize([{ year: 1, job: 2 }])).toBe('[{"job":2,"year":1}]');
  });

  it("clears everything", async ({ expect }) => {
    const cache = await createCache();

    cache.set(["a"], 1);
    cache.set(["b"], 2);
    cache.clear();

    expect(cache.get(["a"])).toBe(undefined);
    expect(cache.get(["b"])).toBe(undefined);
  });

  it("never listens for a tab return or a reconnect on the server", async ({
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

  it("creates no eviction timer on the server", async ({ expect }) => {
    const alepha = Alepha.create()
      .with({ provide: DateTimeProvider, use: TestDateTimeProvider })
      .with(AlephaDateTime);
    const cache = alepha.inject(QueryCache);
    await alepha.start();
    const dateTime = alepha.inject(TestDateTimeProvider);

    cache.set(["k"], "v");
    const unobserve = cache.observe({
      key: ["j"],
      refetch: () => {},
      failed: () => false,
      options: () => ({ staleTime: 0 }),
    });
    unobserve();

    expect(dateTime.pendingTimeouts()).toBe(0);
  });

  it("dedupe never shares a request between two request contexts", async ({
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
