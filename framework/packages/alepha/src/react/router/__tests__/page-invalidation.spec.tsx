import { $inject, Alepha, z } from "alepha";
import { CacheProvider, MemoryCacheProvider } from "alepha/cache";
import { $action, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import {
  AlephaReactRouter,
  ReactPageCacheProvider,
  reactPageCacheOptions,
} from "../index.ts";
import { $page } from "../primitives/$page.ts";

/**
 * Invalidation from writes (#E78): `page.invalidate(params?)` and
 * `$page({ cache: { invalidatedBy } })` purge the entries a write made stale.
 */
describe("page cache invalidation", () => {
  /**
   * Stands for Redis: a provider that is not the in-memory one, which the
   * page cache uses as is, prefix invalidation included.
   */
  class RemoteCacheProvider extends CacheProvider {
    protected readonly inner = $inject(MemoryCacheProvider);

    public get(name: string, key: string) {
      return this.inner.get(name, key);
    }

    public set(name: string, key: string, value: Uint8Array, ttl?: number) {
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

  const revisions: Record<number, number> = {};

  /**
   * A page whose param is a number: the request's is the string `"5"`, a
   * purge is handed the number `5`.
   */
  class Items {
    itemUpdate = $action({
      path: "/items/:id",
      method: "POST",
      schema: {
        params: z.object({ id: z.number() }),
        response: z.object({ id: z.number() }),
      },
      handler: ({ params }) => {
        revisions[params.id] = (revisions[params.id] ?? 0) + 1;
        return { id: params.id };
      },
    });

    item = $page({
      path: "/item/:id",
      schema: { params: z.object({ id: z.number() }) },
      cache: {
        invalidatedBy: [
          { action: "itemUpdate", params: ({ result }) => ({ id: result.id }) },
        ],
      },
      loader: ({ params }) => ({
        label: `item ${params.id} r${revisions[params.id] ?? 0}`,
      }),
      component: (props: { label: string }) => props.label,
    });
  }

  const boot = async (remote = false) => {
    for (const id of Object.keys(revisions)) {
      delete revisions[Number(id)];
    }
    const stock: Record<string, number> = { ring: 1, collar: 1 };
    let renders = 0;

    class App {
      productUpdate = $action({
        path: "/products/:slug",
        method: "POST",
        schema: {
          params: z.object({ slug: z.text() }),
          body: z.object({ stock: z.number(), fail: z.boolean().optional() }),
          response: z.object({ slug: z.text() }),
        },
        handler: ({ params, body }) => {
          if (body.fail) {
            throw new Error("refused");
          }
          stock[params.slug] = body.stock;
          return { slug: params.slug };
        },
      });

      catalogueReset = $action({
        path: "/catalogueReset",
        method: "POST",
        handler: () => "ok",
      });

      product = $page({
        path: "/product/:slug",
        schema: {
          params: z.object({ slug: z.text() }),
          query: z.object({ tab: z.text().optional() }),
        },
        cache: {
          invalidatedBy: [
            {
              action: "productUpdate",
              params: ({ result }) => ({ slug: result.slug }),
            },
            { action: "catalogueReset" },
          ],
        },
        loader: ({ params }) => {
          renders++;
          return { slug: params.slug, stock: stock[params.slug] };
        },
        component: (props: { slug: string; stock: number }) =>
          `${props.slug}:${props.stock}`,
      });
    }

    const alepha = Alepha.create();
    if (remote) {
      alepha.with({ provide: CacheProvider, use: RemoteCacheProvider });
    }
    alepha.with(AlephaReactRouter).with(App).with(Items);
    // Counts renders; the anonymous re-render would double them.
    alepha.store.mut(reactPageCacheOptions, (it) => ({
      ...it,
      anonymousCheck: false,
    }));
    const app = alepha.inject(App);
    await alepha.start();
    const base = alepha.inject(ServerProvider).hostname;

    const visit = async (path: string) => {
      const res = await fetch(`${base}${path}`);
      const body = await res.text();
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { body, cache: res.headers.get("x-alepha-cache") ?? "" };
    };

    const post = async (slug: string, body: object) =>
      fetch(`${base}/api/products/${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    return {
      app,
      items: alepha.inject(Items),
      visit,
      post,
      renders: () => renders,
      pageCache: alepha.inject(ReactPageCacheProvider),
    };
  };

  for (const remote of [false, true]) {
    const where = remote ? "a remote provider" : "the in-process tier";

    it(`page.invalidate(params) purges those params in every query, and only them, on ${where}`, async ({
      expect,
    }) => {
      const { app, visit } = await boot(remote);
      await visit("/product/ring");
      await visit("/product/ring?tab=reviews");
      await visit("/product/collar");

      await app.product.invalidate({ slug: "ring" });

      expect((await visit("/product/ring")).cache).toBe("miss");
      expect((await visit("/product/ring?tab=reviews")).cache).toBe("miss");
      expect((await visit("/product/collar")).cache).toBe(
        "hit; verdict=shared",
      );
    });

    it(`page.invalidate() purges every entry of the page on ${where}`, async ({
      expect,
    }) => {
      const { app, visit } = await boot(remote);
      await visit("/product/ring");
      await visit("/product/collar");

      await app.product.invalidate();

      expect((await visit("/product/ring")).cache).toBe("miss");
      expect((await visit("/product/collar")).cache).toBe("miss");
    });
  }

  for (const remote of [false, true]) {
    const where = remote ? "a remote provider" : "the in-process tier";

    it(`purges a page whose param is a number, by action and by hand, on ${where}`, async ({
      expect,
    }) => {
      const { items, visit } = await boot(remote);
      expect((await visit("/item/5")).body).toContain("item 5 r0");
      expect((await visit("/item/5")).cache).toBe("hit; verdict=shared");
      await visit("/item/6");

      await items.itemUpdate.run({ params: { id: 5 } });

      expect((await visit("/item/5")).body).toContain("item 5 r1");
      expect((await visit("/item/5")).cache).toBe("hit; verdict=shared");
      expect((await visit("/item/6")).cache).toBe("hit; verdict=shared");

      await items.item.invalidate({ id: 5 });

      expect((await visit("/item/5")).cache).toBe("miss");
      expect((await visit("/item/6")).cache).toBe("hit; verdict=shared");
    });
  }

  it("refuses a partial or unknown param set instead of purging nothing", async ({
    expect,
  }) => {
    const { app } = await boot();

    await expect(app.product.invalidate({ id: "ring" })).rejects.toThrow(
      /takes exactly \{slug\}/,
    );
  });

  it("purges after a successful write over HTTP, so the writer reads it", async ({
    expect,
  }) => {
    const { visit, post } = await boot();
    expect((await visit("/product/ring")).body).toContain("ring:1");
    expect((await visit("/product/ring")).cache).toBe("hit; verdict=shared");

    const res = await post("ring", { stock: 7 });
    expect(res.status).toBe(200);

    expect((await visit("/product/ring")).body).toContain("ring:7");
  });

  it("purges after a successful in-process write", async ({ expect }) => {
    const { app, visit } = await boot();
    await visit("/product/collar");

    await app.productUpdate.run({
      params: { slug: "collar" },
      body: { stock: 3 },
    });

    expect((await visit("/product/collar")).body).toContain("collar:3");
  });

  it("keeps the entry when the write fails", async ({ expect }) => {
    const { visit, post, renders } = await boot();
    await visit("/product/ring");

    const res = await post("ring", { stock: 9, fail: true });
    expect(res.status).toBe(500);

    expect((await visit("/product/ring")).cache).toBe("hit; verdict=shared");
    expect(renders()).toBe(1);
  });

  it("purges the whole page for an invalidation without params", async ({
    expect,
  }) => {
    const { app, visit } = await boot();
    await visit("/product/ring");
    await visit("/product/collar");

    await app.catalogueReset.run();

    expect((await visit("/product/ring")).cache).toBe("miss");
    expect((await visit("/product/collar")).cache).toBe("miss");
  });
});
