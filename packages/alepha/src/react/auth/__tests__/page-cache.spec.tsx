import { randomUUID } from "node:crypto";

import { $inject, Alepha, z } from "alepha";
import { CacheProvider, MemoryCacheProvider } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";
import { useStore } from "alepha/react";
import {
  $page,
  AlephaReactRouter,
  ReactPageCacheProvider,
  Redirection,
  reactPageCacheOptions,
} from "alepha/react/router";
import { $issuer, AlephaSecurity, currentUserAtom } from "alepha/security";
import { ServerProvider } from "alepha/server";
import { $cookie } from "alepha/server/cookies";
import { describe, it } from "vitest";

import { AlephaReactAuth } from "../index.ts";

/**
 * The automatic page cache (#E78): a page that reads nothing personal is
 * cached for everyone, and a signed-in visitor gets the cached page with
 * their own private script appended.
 */
describe("automatic page cache", () => {
  const PRIVATE =
    /<script id="__ssr_private" type="application\/json">(.*?)<\/script>/;

  const UserBadge = () => {
    const [user] = useStore(currentUserAtom);
    return <span>{user?.id ?? "anonymous"}</span>;
  };

  /**
   * Stands for Redis: any provider that is not the in-memory one, which the
   * page cache uses as is instead of its own LRU.
   */
  class RemoteCacheProvider extends CacheProvider {
    protected readonly inner = $inject(MemoryCacheProvider);
    public writes = 0;

    public get(name: string, key: string) {
      return this.inner.get(name, key);
    }

    public set(name: string, key: string, value: Uint8Array, ttl?: number) {
      this.writes++;
      return this.inner.set(name, key, value, ttl);
    }

    public del(name: string, ...keys: string[]) {
      return this.inner.del(name, ...keys);
    }

    public has(name: string, key: string) {
      return this.inner.has(name, key);
    }

    public keys(name: string, filter?: string) {
      return this.inner.keys(name, filter);
    }

    public clear() {
      return this.inner.clear();
    }

    public incr(name: string, key: string, amount: number, ttl?: number) {
      return this.inner.incr(name, key, amount, ttl);
    }
  }

  const boot = async (env: Record<string, string> = {}, remote = false) => {
    const calls: Record<string, number> = {};
    const count = (name: string) => {
      calls[name] = (calls[name] ?? 0) + 1;
    };

    class App {
      realm = $issuer({
        secret: "page-cache-secret",
        roles: [{ name: "user", permissions: [{ name: "*" }] }],
      });

      theme = $cookie({ name: "theme", schema: z.text() });

      shared = $page({
        path: "/",
        loader: () => {
          count("shared");
          return { at: calls.shared };
        },
        component: (props: { at: number }) => `render ${props.at}`,
      });

      plain = $page({
        path: "/plain",
        component: () => "no loader",
      });

      personal = $page({
        path: "/personal",
        loader: () => {
          count("personal");
          return {};
        },
        component: UserBadge,
      });

      off = $page({
        path: "/off",
        cache: false,
        loader: () => {
          count("off");
          return {};
        },
        component: () => "off",
      });

      short = $page({
        path: "/short",
        cache: { ttl: [5, "seconds"] },
        loader: () => {
          count("short");
          return {};
        },
        component: () => "short",
      });

      broken = $page({
        path: "/broken",
        loader: () => {
          count("broken");
          throw new Error("loader failed");
        },
        component: () => "never",
      });

      moved = $page({
        path: "/moved",
        loader: () => {
          count("moved");
          throw new Redirection("/");
        },
        component: () => "never",
      });

      crash = $page({
        path: "/crash",
        loader: () => {
          count("crash");
          return {};
        },
        component: () => {
          throw new Error("render failed");
        },
      });

      cookie = $page({
        path: "/cookie",
        loader: () => {
          count("cookie");
          this.theme.set("dark");
          return {};
        },
        component: () => "cookie",
      });

      search = $page({
        path: "/search",
        schema: { query: z.object({ q: z.text().optional() }) },
        loader: ({ query }) => {
          count("search");
          return { q: query.q ?? "" };
        },
        component: (props: { q: string }) => `results for ${props.q}`,
      });

      product = $page({
        path: "/product/:slug",
        schema: { params: z.object({ slug: z.text() }) },
        loader: ({ params }) => {
          count("product");
          return { slug: params.slug };
        },
        component: (props: { slug: string }) => `product ${props.slug}`,
      });
    }

    const alepha = Alepha.create({ env });
    if (remote) {
      alepha.with({ provide: CacheProvider, use: RemoteCacheProvider });
    }
    alepha
      .with(AlephaReactRouter)
      .with(AlephaSecurity)
      .with(AlephaReactAuth)
      .with(App);
    // These count loader runs; the anonymous re-render runs them twice and
    // has its own spec (page-anonymous-check).
    alepha.store.mut(reactPageCacheOptions, (it) => ({
      ...it,
      anonymousCheck: false,
    }));
    const app = alepha.inject(App);
    await alepha.start();
    const base = alepha.inject(ServerProvider).hostname;

    const visit = async (path: string, token?: string) => {
      const res = await fetch(`${base}${path}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      const body = await res.text();
      // Let the stream-end write land before the next request.
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { res, body, cache: res.headers.get("x-alepha-cache") ?? "" };
    };

    const signIn = async () =>
      (await app.realm.createToken({ id: randomUUID(), roles: ["user"] }))
        .access_token;

    return {
      alepha,
      calls,
      visit,
      signIn,
      pageCache: alepha.inject(ReactPageCacheProvider),
      time: alepha.inject(DateTimeProvider),
    };
  };

  it("serves a shared page from the cache, to a signed-in visitor too, with their own private script", async ({
    expect,
  }) => {
    const { visit, calls, signIn } = await boot();
    const token = await signIn();

    const first = await visit("/");
    const second = await visit("/", token);
    const third = await visit("/");

    expect(first.cache).toBe("miss");
    expect(second.cache).toBe("hit; verdict=shared");
    expect(third.cache).toBe("hit; verdict=shared");
    expect(calls.shared).toBe(1);
    expect(second.body).toContain("render 1");

    // The cached copy carries nobody; each visitor's script is their own.
    const own = JSON.parse(second.body.match(PRIVATE)![1]);
    expect(own["alepha.security.user"]).toBeDefined();
    const anonymous = third.body.match(PRIVATE);
    expect(anonymous ? JSON.parse(anonymous[1]) : {}).not.toHaveProperty(
      "alepha.security.user",
    );
    expect(second.body.replace(PRIVATE, "")).toBe(
      third.body.replace(PRIVATE, ""),
    );
  });

  it("never caches a page whose render reads the visitor", async ({
    expect,
  }) => {
    const { visit, calls, signIn } = await boot();
    const alice = await signIn();
    const bob = await signIn();

    const a = await visit("/personal", alice);
    const b = await visit("/personal", bob);

    expect(calls.personal).toBe(2);
    expect(b.cache).toBe("miss");
    expect(a.body).not.toBe(b.body);
  });

  it("caches nothing for a page that opted out", async ({ expect }) => {
    const { visit, calls } = await boot();

    await visit("/off");
    const second = await visit("/off");

    expect(calls.off).toBe(2);
    expect(second.cache).toBe("off");
  });

  it("never writes a render that failed, redirected, or set a cookie", async ({
    expect,
  }) => {
    const { visit, calls } = await boot();

    for (const path of ["/broken", "/crash", "/moved", "/cookie"]) {
      await visit(path);
      await visit(path);
    }

    expect(calls.broken).toBe(2);
    expect(calls.crash).toBe(2);
    expect(calls.moved).toBe(2);
    expect(calls.cookie).toBe(2);
  });

  it("never writes a 404", async ({ expect }) => {
    const { visit, pageCache } = await boot();

    const res = await visit("/no/such/page");

    expect(res.res.status).toBe(404);
    expect(pageCache.size).toBe(0);
  });

  it("keys by declared query, and bypasses a request carrying an undeclared one", async ({
    expect,
  }) => {
    const { visit, calls } = await boot();

    await visit("/search?q=ring");
    const again = await visit("/search?q=ring");
    const other = await visit("/search?q=collar");
    const bypass = await visit("/search?q=ring&token=secret");

    expect(again.cache).toBe("hit; verdict=shared");
    expect(other.body).toContain("results for collar");
    expect(bypass.cache).toBe("bypass");
    expect(calls.search).toBe(3);
  });

  it("bypasses an undeclared query on a page that declares none", async ({
    expect,
  }) => {
    const { visit, pageCache } = await boot();

    const res = await visit("/plain?reset=abc");

    expect(res.cache).toBe("bypass");
    expect(pageCache.size).toBe(0);
  });

  it("keys by params, escaped", async ({ expect }) => {
    const { visit, calls, alepha } = await boot();
    const pageCache = alepha.inject(ReactPageCacheProvider);

    await visit("/product/a%3Ab");
    await visit("/product/a%3Ab");
    await visit("/product/other");

    expect(calls.product).toBe(2);
    expect(pageCache.size).toBe(2);
  });

  it("keeps a page with a loader 60 seconds and a loader-less one until the next deploy", async ({
    expect,
  }) => {
    const { visit, calls, time } = await boot();

    await visit("/");
    await visit("/plain");
    await time.travel([61, "seconds"]);

    expect((await visit("/plain")).cache).toBe("hit; verdict=shared");
    expect((await visit("/")).cache).toBe("miss");
    expect(calls.shared).toBe(2);
  });

  it("lets a page set its own lifetime", async ({ expect }) => {
    const { visit, calls, time } = await boot();

    await visit("/short");
    await time.travel([6, "seconds"]);
    await visit("/short");

    expect(calls.short).toBe(2);
  });

  it("bounds the in-process tier, evicting the least recently used", async ({
    expect,
  }) => {
    const { visit, alepha, pageCache } = await boot();
    alepha.store.mut(reactPageCacheOptions, (it) => ({ ...it, max: 2 }));

    await visit("/product/a");
    await visit("/product/b");
    await visit("/product/a");
    await visit("/product/c");

    expect(pageCache.size).toBe(2);
    expect((await visit("/product/a")).cache).toBe("hit; verdict=shared");
    expect((await visit("/product/b")).cache).toBe("miss");
  });

  it("stores entries in the app's provider when it is not the in-memory one", async ({
    expect,
  }) => {
    const { visit, calls, alepha, pageCache } = await boot({}, true);

    await visit("/");
    const second = await visit("/");

    expect(second.cache).toBe("hit; verdict=shared");
    expect(calls.shared).toBe(1);
    expect(alepha.inject(RemoteCacheProvider).writes).toBe(1);
    expect(pageCache.size).toBe(0);
  });

  it("turns off with REACT_PAGE_CACHE=false", async ({ expect }) => {
    const { visit, calls } = await boot({ REACT_PAGE_CACHE: "false" });

    await visit("/");
    const second = await visit("/");

    expect(calls.shared).toBe(2);
    expect(second.cache).toBe("off");
  });

  it("draws a fresh build id per container when nothing built the code", async ({
    expect,
  }) => {
    const one = (await boot()).pageCache.buildId();
    const two = (await boot()).pageCache.buildId();

    expect(one).toMatch(/^dev-/);
    expect(one).not.toBe(two);
  });
});
