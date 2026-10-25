import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { $cache } from "../index.ts";
import { CacheProvider } from "../providers/CacheProvider.ts";
import { MemoryCacheProvider } from "../providers/MemoryCacheProvider.ts";

/**
 * A provider whose writes always fail — a Redis outage, a KV quota, a
 * network blip. Reads keep working so the failure is isolated to `set`.
 */
class FailingWriteCacheProvider extends MemoryCacheProvider {
  public writeAttempts = 0;

  public override async set(): Promise<Uint8Array> {
    this.writeAttempts++;
    throw new Error("cache backend is down");
  }
}

describe("$cache write failures", () => {
  const create = () =>
    Alepha.create().with({
      provide: CacheProvider,
      use: FailingWriteCacheProvider,
    });

  it("should still return the handler result in primitive mode", async () => {
    // Middleware mode already swallowed write failures
    // (`instance.set(...).catch(() => {})`), but `run()` awaited the write
    // unguarded — so a cache outage turned a request that had already
    // computed a perfectly good answer into a 500. The cache is an
    // optimisation; it must never be the thing that fails the request.
    class App {
      compute = $cache({
        handler: async (n: number) => n * 2,
      });
    }

    const alepha = create();
    const app = alepha.inject(App);
    await alepha.start();

    await expect(app.compute.run(21)).resolves.toBe(42);
  });

  it("should still return the handler result in middleware mode", async () => {
    class App {
      compute = $cache({})(async (n: number) => n * 2);
    }

    const alepha = create();
    const app = alepha.inject(App);
    await alepha.start();

    await expect(app.compute(21)).resolves.toBe(42);
  });

  it("should attempt the write on both paths", async () => {
    // Guards the fix against the lazy reading of "non-fatal" — dropping the
    // write entirely would also make the tests above pass.
    class App {
      viaRun = $cache({ handler: async (n: number) => n * 2 });
      viaMiddleware = $cache({})(async (n: number) => n * 3);
    }

    const alepha = create();
    const app = alepha.inject(App);
    await alepha.start();
    const provider = alepha.inject(
      CacheProvider,
    ) as unknown as FailingWriteCacheProvider;

    await app.viaRun.run(1);
    await app.viaMiddleware(1);
    // The middleware path does not await its write.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(provider.writeAttempts).toBe(2);
  });
});
