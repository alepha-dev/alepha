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

    /**
     * `schema.params` is optional, so this routes fine. It must still be kept
     * out of the sitemap: it has no concrete URL to offer.
     */
    untypedParam = $page({
      path: "/notes/:noteSlug",
      component: () => "note",
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

  it("excludes a parameterized page that never declared a params schema", async ({
    expect,
  }) => {
    const { alepha } = await start();

    const { body } = sitemapOf(alepha).prerender();

    // The bug this guards: the raw pattern shipped to crawlers as a real URL.
    expect(body).not.toContain(":noteSlug");
    expect(body).not.toContain("/notes/");
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

  describe("nested pages", () => {
    /**
     * The sitemap listed each page's own segment and never walked up, so a page
     * under a layout with a prefix was advertised at a URL that 404s.
     */
    class NestedApp {
      sitemap = $sitemap({ hostname: "https://example.com" });

      docs = $page({
        path: "/docs",
        component: () => "docs",
        children: () => [this.guides],
      });

      guides = $page({
        path: "/guides",
        component: () => "guides",
        children: () => [this.intro],
      });

      intro = $page({
        path: "/intro",
        static: true,
        component: () => "intro",
      });

      /**
       * Linked from the child side, the other way an edge is declared.
       */
      settings = $page({
        parent: this.docs,
        path: "/settings",
        static: true,
        component: () => "settings",
      });

      /**
       * Static segment of its own, but the parent carries the parameter, so
       * there is still no concrete URL to list.
       */
      org = $page({
        path: "/org/:orgId",
        component: () => "org",
        children: () => [this.members],
      });

      members = $page({
        path: "/members",
        static: true,
        component: () => "members",
      });

      /**
       * Enumerates its own URLs, and they have to be built from the full path.
       */
      post = $page({
        parent: this.guides,
        path: "/post/:slug",
        schema: { params: z.object({ slug: z.text() }) },
        static: { entries: [{ params: { slug: "hello" } }] },
        component: () => "post",
      });
    }

    const startNested = async () => {
      const alepha = Alepha.create()
        .with(AlephaReactRouter)
        .with(AlephaReactSitemap);
      alepha.inject(NestedApp);
      await alepha.start();
      return alepha;
    };

    it("lists a page two layouts deep at its real url", async ({ expect }) => {
      const alepha = await startNested();
      const { body } = sitemapOf(alepha).prerender();

      expect(body).toContain(
        "<loc>https://example.com/docs/guides/intro</loc>",
      );
      expect(body).not.toContain("<loc>https://example.com/intro</loc>");
    });

    it("composes an edge declared from the child", async ({ expect }) => {
      const alepha = await startNested();
      const { body } = sitemapOf(alepha).prerender();

      expect(body).toContain("<loc>https://example.com/docs/settings</loc>");
      expect(body).not.toContain("<loc>https://example.com/settings</loc>");
    });

    it("skips a page whose parent carries the parameter", async ({
      expect,
    }) => {
      const alepha = await startNested();
      const { body } = sitemapOf(alepha).prerender();

      expect(body).not.toContain("/members");
      expect(body).not.toContain(":orgId");
    });

    it("expands static.entries against the full path", async ({ expect }) => {
      const alepha = await startNested();
      const { body } = sitemapOf(alepha).prerender();

      expect(body).toContain(
        "<loc>https://example.com/docs/guides/post/hello</loc>",
      );
    });

    it("still excludes the layouts themselves", async ({ expect }) => {
      const alepha = await startNested();
      const { body } = sitemapOf(alepha).prerender();

      expect(body).not.toContain("<loc>https://example.com/docs</loc>");
      expect(body).not.toContain("<loc>https://example.com/docs/guides</loc>");
    });
  });
});
