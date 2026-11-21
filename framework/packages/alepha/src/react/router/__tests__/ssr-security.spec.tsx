import http from "node:http";

import { Alepha, z } from "alepha";
import { HttpError, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import {
  $page,
  AlephaReactRouter,
  ReactPageCacheProvider,
  ReactPageProvider,
  ReactServerTemplateProvider,
  RouterLocaleProvider,
  reactPageCacheOptions,
} from "../index.ts";

/**
 * What a visitor can make the server write into bytes another visitor reads:
 * the request's `Host` in a cached page, a crafted query under an ordinary
 * URL's cache key, an error's message in the hydration payload, and a loader
 * value closing an inline head script.
 */
describe("SSR security", () => {
  /**
   * A GET with a `Host` of the caller's choosing, which `fetch` refuses to
   * set.
   */
  const get = (base: string, path: string, host?: string) =>
    new Promise<string>((resolve, reject) => {
      const url = new URL(base + path);
      const request = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path,
          headers: { accept: "text/html", ...(host ? { host } : {}) },
        },
        (response) => {
          let body = "";
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () => resolve(body));
        },
      );
      request.on("error", reject);
      request.end();
    });

  const start = async (
    App: new () => any,
    env: Record<string, unknown> = {},
    configure?: (alepha: Alepha) => void,
  ) => {
    const alepha = Alepha.create({
      env: { SERVER_PORT: 0, APP_SECRET: "x".repeat(40), ...env },
    })
      .with(AlephaReactRouter)
      .with(App);
    configure?.(alepha);
    await alepha.start();
    return { alepha, base: alepha.inject(ServerProvider).hostname };
  };

  const alternates = (html: string) =>
    (html.match(/<link rel="alternate"[^>]*>/g) ?? []).join(" ");

  const payload = (html: string) =>
    JSON.parse(
      html.match(
        /<script id="__ssr" type="application\/json">(.*?)<\/script>/,
      )?.[1] ?? "{}",
    );

  describe("the Host header and the page cache", () => {
    class App {
      about = $page({ path: "/about", component: () => <b>about</b> });
    }

    const withLocales = (alepha: Alepha) => {
      alepha.inject(RouterLocaleProvider).configure({
        enabled: true,
        defaultLocale: "en",
        locales: ["en", "fr"],
      });
    };

    it("never serves one host the page rendered for another", async ({
      expect,
    }) => {
      const { alepha, base } = await start(App, {}, withLocales);

      const forged = await get(base, "/about", "evil.example");
      expect(alternates(forged)).toContain("http://evil.example/about");
      // The cache write runs after the response ends.
      await expect
        .poll(() => alepha.inject(ReactPageCacheProvider).size)
        .toBe(1);

      const real = await get(base, "/about");
      expect(real).not.toContain("evil.example");
      expect(alternates(real)).toContain(`${base}/fr/about`);

      await alepha.stop();
    });

    it("writes hreflang links from PUBLIC_URL when it is set", async ({
      expect,
    }) => {
      const { alepha, base } = await start(
        App,
        { PUBLIC_URL: "https://www.example.app/" },
        withLocales,
      );

      const html = await get(base, "/about", "evil.example");
      expect(html).not.toContain("evil.example");
      expect(alternates(html)).toContain(
        '<link rel="alternate" href="https://www.example.app/fr/about" hreflang="fr">',
      );

      await alepha.stop();
    });

    it("keys an entry by the request's origin", async ({ expect }) => {
      const { alepha } = await start(App);
      const cache = alepha.inject(ReactPageCacheProvider);
      const route = alepha.inject(ReactPageProvider).page("about");

      expect(cache.key(route, {}, {}, "en", "http://a.example")).not.toBe(
        cache.key(route, {}, {}, "en", "http://b.example"),
      );
      // An invalidation still reaches every origin's entry.
      expect(
        cache
          .key(route, {}, {}, "en", "http://a.example")
          .startsWith(cache.prefix(route, {})),
      ).toBe(true);

      await alepha.stop();
    });
  });

  describe("the page cache key", () => {
    class App {
      search = $page({
        path: "/s",
        schema: {
          query: z.object({ a: z.text().optional(), b: z.text().optional() }),
        },
        loader: async ({ query }) => ({ q: JSON.stringify(query) }),
        component: (props: { q: string }) => <b>{props.q}</b>,
      });
      pair = $page({
        path: "/p/:a/:b",
        component: () => <b>pair</b>,
      });
    }

    const noCheck = (alepha: Alepha) => {
      alepha.store.set(reactPageCacheOptions, {
        ...alepha.store.get(reactPageCacheOptions),
        anonymousCheck: false,
      });
    };

    it("keeps a query value holding & and = apart from two parameters", async ({
      expect,
    }) => {
      const { alepha, base } = await start(App, {}, noCheck);
      const cache = alepha.inject(ReactPageCacheProvider);
      const route = alepha.inject(ReactPageProvider).page("search");

      expect(cache.key(route, {}, { a: "x&b=y" }, undefined)).not.toBe(
        cache.key(route, {}, { a: "x", b: "y" }, undefined),
      );

      const crafted = await get(base, "/s?a=x%26b%3Dy");
      expect(crafted).toContain("x&amp;b=y");
      await expect.poll(() => cache.size).toBe(1);

      const ordinary = await get(base, "/s?a=x&b=y");
      expect(ordinary).not.toContain("x&amp;b=y");

      await alepha.stop();
    });

    it("keeps a param value holding & and = apart from two params", async ({
      expect,
    }) => {
      const { alepha } = await start(App, {}, noCheck);
      const cache = alepha.inject(ReactPageCacheProvider);
      const route = alepha.inject(ReactPageProvider).page("pair");

      expect(cache.prefix(route, { a: "1&b=2", b: "" })).not.toBe(
        cache.prefix(route, { a: "1", b: "2&b=" }),
      );
      expect(cache.prefix(route, { a: "1", b: "2" })).toBe(
        cache.prefix(route, { b: "2", a: "1" }),
      );

      await alepha.stop();
    });
  });

  describe("an error in the hydration payload", () => {
    class App {
      boom = $page({
        path: "/boom",
        loader: async () => {
          throw Object.assign(new Error("db: password=hunter2"), {
            query: "select * from users where token = $1",
            params: ["s3cr3t"],
          });
        },
        component: () => <b>x</b>,
      });
      refused = $page({
        path: "/refused",
        loader: async () => {
          throw new HttpError({ status: 404 }, { message: "No such order" });
        },
        component: () => <b>x</b>,
      });
      upstream = $page({
        path: "/upstream",
        loader: async () => {
          throw new HttpError(
            { status: 502 },
            { message: "redis://user:hunter2@10.0.0.1" },
          );
        },
        component: () => <b>x</b>,
      });
      late = $page({
        path: "/late",
        stream: false,
        loader: async () => ({
          value: Promise.reject(new Error("db: password=hunter2")),
          refused: Promise.reject(
            new HttpError({ status: 404 }, { message: "No such order" }),
          ),
        }),
        component: () => <b>late</b>,
      });
    }

    const production = { NODE_ENV: "production" };

    it("carries no message and no own field of a crash in production", async ({
      expect,
    }) => {
      const { alepha, base } = await start(App, production);

      const html = await get(base, "/boom");
      expect(html).not.toContain("hunter2");
      expect(html).not.toContain("s3cr3t");
      expect(html).not.toContain("select * from users");
      expect(payload(html)["alepha.react.router.layers"][0].error).toEqual({
        name: "Error",
        message: "Internal Server Error",
      });

      await alepha.stop();
    });

    it("hides a 5xx HttpError's message in production", async ({ expect }) => {
      const { alepha, base } = await start(App, production);

      const html = await get(base, "/upstream");
      expect(html).not.toContain("hunter2");
      expect(payload(html)["alepha.react.router.layers"][0].error).toEqual({
        name: "HTTP",
        message: "Internal Server Error",
        status: 502,
      });

      await alepha.stop();
    });

    it("keeps what a 4xx tells the client in production", async ({
      expect,
    }) => {
      const { alepha, base } = await start(App, production);

      const html = await get(base, "/refused");
      expect(payload(html)["alepha.react.router.layers"][0].error).toEqual({
        name: "HTTP",
        message: "No such order",
        status: 404,
        data: { status: 404 },
      });

      await alepha.stop();
    });

    it("keeps the whole error in development", async ({ expect }) => {
      const { alepha, base } = await start(App);

      const error = payload(await get(base, "/boom"))[
        "alepha.react.router.layers"
      ][0].error;
      expect(error.message).toBe("db: password=hunter2");
      expect(error.params).toEqual(["s3cr3t"]);
      expect(error.stack).toContain("Error: db: password=hunter2");

      await alepha.stop();
    });

    it("hides a rejected deferred value's message in production", async ({
      expect,
    }) => {
      const { alepha, base } = await start(App, production);

      const html = await get(base, "/late");
      expect(html).not.toContain("hunter2");
      const props = payload(html)["alepha.react.router.layers"][0].props;
      expect(props.value.$deferred).toEqual({
        status: "rejected",
        error: { name: "Error", message: "Internal Server Error" },
      });
      expect(props.refused.$deferred).toEqual({
        status: "rejected",
        error: { name: "HTTP", message: "No such order", status: 404 },
      });

      await alepha.stop();
    });

    it("keeps a rejected deferred value's message in development", async ({
      expect,
    }) => {
      const { alepha, base } = await start(App);

      const props = payload(await get(base, "/late"))[
        "alepha.react.router.layers"
      ][0].props;
      expect(props.value.$deferred.error.message).toBe("db: password=hunter2");

      await alepha.stop();
    });
  });

  describe("an inline head script", () => {
    const template = () =>
      Alepha.create()
        .with(AlephaReactRouter)
        .inject(ReactServerTemplateProvider);

    it("cannot be closed by a value in a data block", ({ expect }) => {
      const name = "</script><script>alert(1)</script>\u2028\u2029";
      const html = template().renderHeadContent({
        script: [
          {
            type: "application/ld+json",
            content: JSON.stringify({ name }),
          },
        ],
      });

      expect(html).not.toContain("</script><script>");
      expect(html.match(/<\/script>/g)).toHaveLength(1);
      const content = html.match(/<script[^>]*>(.*)<\/script>/)?.[1] ?? "";
      expect(content).not.toMatch(/[<\u2028\u2029]/);
      // Still the same JSON.
      expect(JSON.parse(content)).toEqual({ name });
    });

    it("cannot be closed by a literal </script or <!-- in code", ({
      expect,
    }) => {
      const html = template().renderHeadContent({
        script: [
          'var a = "</script><script>alert(1)</script>";',
          { content: 'var b = "<!--</SCRIPT >";' },
        ],
      });

      expect(html.match(/<\/script/gi)).toHaveLength(2);
      expect(html).not.toContain("<!--");
      expect(html).toContain(
        'var a = "\\u003c/script><script>alert(1)\\u003c/script>";',
      );
      expect(html).toContain('var b = "\\u003c!--\\u003c/SCRIPT >";');
    });

    it("leaves ordinary code alone", ({ expect }) => {
      const html = template().renderHeadContent({
        script: ["if (a < b && c > d) { go(); }"],
      });

      expect(html).toContain("<script>if (a < b && c > d) { go(); }</script>");
    });
  });
});
