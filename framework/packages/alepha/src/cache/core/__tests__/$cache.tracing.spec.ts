import { Alepha } from "alepha";
import { MemoryTraceProvider, Tracer } from "alepha/tracing";
import { describe, it } from "vitest";

import { $cache, CacheProvider, MemoryCacheProvider } from "../index.ts";

/**
 * `$cache` spans (#E86): `cache <get|set|invalidate> <name>`, with
 * `cache.hit` on reads, the cache's name and never its key.
 */
describe("$cache tracing", () => {
  class Users {
    calls = 0;
    profile = $cache({
      name: "user-profile",
      key: (id: string) => `user:${id}`,
      handler: async (id: string) => `profile of ${id} #${this.calls++}`,
    });
  }

  const boot = async () => {
    const alepha = Alepha.create().with({
      provide: CacheProvider,
      use: MemoryCacheProvider,
    });
    const users = alepha.inject(Users);
    const traces = alepha.inject(MemoryTraceProvider);
    const tracer = alepha.inject(Tracer);
    await alepha.start();
    const inTrace = <R>(fn: () => Promise<R>) =>
      alepha.context.run(() => tracer.startRoot("test", {}, fn));
    return { users, traces, inTrace };
  };

  it("records a miss, the write and a hit, with no key", async ({ expect }) => {
    const { users, traces, inTrace } = await boot();

    await inTrace(async () => {
      await users.profile("secret-id");
      await users.profile("secret-id");
      await users.profile.invalidate();
    });

    const spans = traces.children(traces.find("test")!);
    expect(spans.map((s) => [s.name, s.attributes["cache.hit"]])).toEqual([
      ["cache get user-profile", false],
      ["cache set user-profile", undefined],
      ["cache get user-profile", true],
      ["cache invalidate user-profile", undefined],
    ]);
    const values = spans
      .flatMap((s) => Object.values(s.attributes).map(String))
      .join(" ");
    expect(values).not.toContain("secret-id");
  });

  it("records nothing outside a trace", async ({ expect }) => {
    const { users, traces } = await boot();
    await users.profile("a");
    expect(traces.spans()).toEqual([]);
  });
});
