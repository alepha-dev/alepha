import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { ServerRouterProvider } from "alepha/server";
import { describe, it } from "vitest";

import { AlephaReactSitemap } from "../index.ts";
import { $sitemap, type SitemapPrimitive } from "../primitives/$sitemap.ts";

describe("$sitemap", () => {
  class App {
    sitemap = $sitemap({ hostname: "https://example.com" });

    home = $page({
      path: "/",
      static: true,
      component: () => "home",
    });

    about = $page({
      path: "/about",
      static: true,
      component: () => "about",
    });

    notFound = $page({
      path: "/*",
      component: () => "404",
    });

    github404 = $page({
      path: "/404",
      static: true,
      component: () => "404",
    });

    blog = $page({
      path: "/blog/:slug",
      schema: { params: z.object({ slug: z.text() }) },
      static: { entries: [{ params: { slug: "hello" } }] },
      component: () => "post",
    });
  }

  const start = async () => {
    const alepha = Alepha.create()
      .with(AlephaReactRouter)
      .with(AlephaReactSitemap);
    alepha.inject(App);
    const router = alepha.inject(ServerRouterProvider);
    await alepha.start();
    return { alepha, router };
  };

  const sitemapOf = (alepha: Alepha) =>
    alepha.primitives("sitemap")[0] as SitemapPrimitive;

  const findSitemapRoute = (router: ServerRouterProvider) =>
    router.getRoutes().find((route) => route.path === "/sitemap.xml");

  it("registers a static GET /sitemap.xml route", async ({ expect }) => {
    const { router } = await start();
    const route = findSitemapRoute(router);
    expect(route).toBeDefined();
    expect(route?.method).toBe("GET");
    expect(route?.static).toBe(true);
  });

  it("prerenders xml built from the app's pages", async ({ expect }) => {
    const { alepha } = await start();
    const { path, body } = sitemapOf(alepha).prerender();

    expect(path).toBe("/sitemap.xml");
    expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(body).toContain("<loc>https://example.com/</loc>");
    expect(body).toContain("<loc>https://example.com/about</loc>");
  });

  it("serves application/xml at request time", async ({ expect }) => {
    const { router } = await start();
    const route = findSitemapRoute(router)!;
    const headers: Record<string, string> = {};
    const reply = {
      headers,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
        return this;
      },
    };
    const body = await route.handler.run({ reply } as any);
    expect(headers["content-type"]).toBe("application/xml");
    expect(String(body)).toContain("<urlset");
  });

  it("expands parameterized pages via static.entries", async ({ expect }) => {
    const { alepha } = await start();
    const { body } = sitemapOf(alepha).prerender();
    expect(body).toContain("<loc>https://example.com/blog/hello</loc>");
  });

  it("excludes wildcard and 404 routes", async ({ expect }) => {
    const { alepha } = await start();
    const { body } = sitemapOf(alepha).prerender();
    expect(body).not.toContain("/*");
    expect(body).not.toContain("/404");
  });

  it("falls back to PUBLIC_URL, then relative, when no hostname is given", async ({
    expect,
  }) => {
    class RelApp {
      sitemap = $sitemap();
      home = $page({ path: "/", static: true, component: () => "home" });
    }
    const alepha = Alepha.create()
      .with(AlephaReactRouter)
      .with(AlephaReactSitemap);
    alepha.inject(RelApp);
    await alepha.start();

    const { body } = sitemapOf(alepha).prerender();
    expect(body).toContain("<loc>/</loc>");
  });

  it("uses DateTimeProvider for lastmod (travel-able)", async ({ expect }) => {
    const { alepha } = await start();
    const dateTime = alepha.inject(DateTimeProvider);
    const expected = dateTime.now().format("YYYY-MM-DD");
    const { body } = sitemapOf(alepha).prerender();
    expect(body).toContain(`<lastmod>${expected}</lastmod>`);
  });
});
