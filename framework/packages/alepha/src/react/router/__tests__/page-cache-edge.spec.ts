import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { afterEach, beforeEach, describe, it } from "vitest";

import { AlephaReactRouter, ReactPageCacheProvider } from "../index.ts";

/**
 * The page cache's edge tier on workerd (#E78): entries also go to
 * `caches.default`, under a synthetic URL, for at most 60 seconds, and an
 * invalidation leaves a marker the next read checks, since `caches.default`
 * can delete only exact keys, and only in its own colo.
 *
 * `caches.default` is faked with a Map that honours `max-age`, and the
 * Cloudflare global makes the provider believe it runs on workerd.
 */
describe("page cache edge tier", () => {
  class TestPageCache extends ReactPageCacheProvider {
    /**
     * A fresh isolate: same colo, so same edge, but an empty in-process tier.
     */
    public freshIsolate() {
      this.local.clear();
    }
  }

  class FakeEdge {
    public readonly entries = new Map<
      string,
      { body: string; headers: Headers; expiresAt: number }
    >();

    protected readonly now: () => number;

    constructor(now: () => number) {
      this.now = now;
    }

    async match(url: string) {
      const it = this.entries.get(url);
      if (!it || it.expiresAt <= this.now()) {
        return undefined;
      }
      return new Response(it.body, { headers: it.headers });
    }

    async put(url: string, response: Response) {
      const maxAge = Number(
        /max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "")?.[1],
      );
      this.entries.set(url, {
        body: await response.text(),
        headers: response.headers,
        expiresAt: this.now() + maxAge * 1000,
      });
    }

    async delete(url: string) {
      return this.entries.delete(url);
    }
  }

  const globals = globalThis as {
    Cloudflare?: unknown;
    caches?: unknown;
  };
  const saved = { cloudflare: globals.Cloudflare, caches: globals.caches };

  let alepha: Alepha;
  let cache: TestPageCache;
  let edge: FakeEdge;
  let time: DateTimeProvider;

  beforeEach(async () => {
    alepha = Alepha.create()
      .with({ provide: ReactPageCacheProvider, use: TestPageCache })
      .with(AlephaReactRouter);
    await alepha.start();
    cache = alepha.inject(TestPageCache);
    time = alepha.inject(DateTimeProvider);
    edge = new FakeEdge(() => time.nowMillis());
    globals.Cloudflare = {};
    globals.caches = { default: edge };
  });

  afterEach(() => {
    globals.Cloudflare = saved.cloudflare;
    globals.caches = saved.caches;
  });

  const entry = {
    head: "<html>shared",
    tail: "</html>",
    status: 200,
    verdict: "shared" as const,
    headers: {},
  };
  const KEY = "page:b1:product:slug%3Dring:-:fr";

  const freshIsolate = () => cache.freshIsolate();

  it("writes the entry to caches.default and reads it back in another isolate", async ({
    expect,
  }) => {
    await cache.write(KEY, entry, 0);
    freshIsolate();

    const read = await cache.read(KEY);

    expect(read?.head).toBe("<html>shared");
    expect(edge.entries.size).toBe(1);
  });

  it("caps an entry at 60 seconds on workerd, even one kept until the next deploy", async ({
    expect,
  }) => {
    await cache.write(KEY, entry, 0);
    await time.travel([61, "seconds"]);
    freshIsolate();

    expect(await cache.read(KEY)).toBeUndefined();
  });

  it("an invalidation in this colo hides the entry from every isolate", async ({
    expect,
  }) => {
    await cache.write(KEY, entry, 0);
    await time.travel([1, "seconds"]);

    await cache.invalidate("page:b1:product:slug%3Dring:");
    freshIsolate();

    expect(await cache.read(KEY)).toBeUndefined();
  });

  it("an invalidation of the whole page hides every params of it", async ({
    expect,
  }) => {
    await cache.write(KEY, entry, 0);
    await time.travel([1, "seconds"]);

    await cache.invalidate("page:b1:product:");

    expect(await cache.read(KEY)).toBeUndefined();
  });

  it("an entry written after the invalidation is served", async ({
    expect,
  }) => {
    await cache.invalidate("page:b1:product:");
    await time.travel([1, "seconds"]);
    await cache.write(KEY, entry, 0);
    freshIsolate();

    expect((await cache.read(KEY))?.head).toBe("<html>shared");
  });
});
