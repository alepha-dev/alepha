import { createHash } from "node:crypto";
import http from "node:http";

import { Alepha, z } from "alepha";
import { BackgroundTaskProvider } from "alepha/background";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { $head } from "alepha/react/head";
import { HttpError, helmetOptions, ServerProvider } from "alepha/server";
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
  /**
   * The `x-alepha-cache` header of the last {@link get}.
   */
  let outcome: string | undefined;

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
          outcome = String(response.headers["x-alepha-cache"] ?? "");
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
    memoryLogs = false,
  ) => {
    const alepha = Alepha.create({
      env: { SERVER_PORT: 0, APP_SECRET: "x".repeat(40), ...env },
    });
    if (memoryLogs) {
      // A substitution, so ahead of everything that logs.
      alepha.with({
        provide: LogDestinationProvider,
        use: MemoryDestinationProvider,
      });
    }
    alepha.with(AlephaReactRouter).with(App);
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

    it("with PUBLIC_URL, stores nothing for another host and still hits on its own", async ({
      expect,
    }) => {
      const { alepha, base } = await start(
        App,
        { PUBLIC_URL: "http://site.example" },
        withLocales,
      );
      const cache = alepha.inject(ReactPageCacheProvider);
      const visit = async (host: string) => {
        const html = await get(base, "/about", host);
        // The cache write, if any, is background work registered with the
        // request.
        await alepha.inject(BackgroundTaskProvider).flush();
        return html;
      };

      for (const host of ["evil.example", "a.evil.example", "b.evil.example"]) {
        expect(await visit(host)).toContain("about");
      }
      expect(cache.size).toBe(0);

      await visit("site.example");
      expect(outcome).toBe("miss");
      expect(cache.size).toBe(1);
      // Its other spellings read the same entry, and add none.
      await visit("SITE.example.");
      expect(outcome).toBe("hit; verdict=shared");
      // Another host is still rendered, beside the entry.
      await visit("evil.example");
      expect(outcome).toBe("bypass");
      expect(cache.size).toBe(1);

      await alepha.stop();
    });

    it("warns once per host that PUBLIC_URL keeps out of the cache, and not without end", async ({
      expect,
    }) => {
      const { alepha, base } = await start(
        App,
        { PUBLIC_URL: "http://site.example" },
        undefined,
        true,
      );
      const warnings = () =>
        alepha
          .inject(MemoryDestinationProvider)
          .logs.filter(
            (entry) =>
              entry.level === "WARN" &&
              entry.message.includes("is not served from the page cache"),
          )
          .map((entry) => entry.message);

      await get(base, "/about", "site.example");
      expect(warnings()).toEqual([]);

      await get(base, "/about", "www.site.example");
      await get(base, "/about", "www.site.example");
      await get(base, "/about", "site.example:8080");
      expect(warnings()).toHaveLength(2);
      expect(warnings()[0]).toContain('"www.site.example"');
      expect(warnings()[0]).toContain('"site.example"');
      expect(warnings()[0]).toContain("PUBLIC_URL");
      expect(warnings()[1]).toContain('"site.example:8080"');

      // Made-up hosts cannot fill the log.
      for (let i = 0; i < 40; i++) {
        await get(base, "/about", `h${i}.evil.example`);
      }
      expect(warnings().length).toBeLessThanOrEqual(
        ReactPageCacheProvider.FOREIGN_HOST_WARNINGS,
      );

      await alepha.stop();
    });

    it("without PUBLIC_URL, a trailing dot and the case are one key", async ({
      expect,
    }) => {
      const { alepha } = await start(App);
      const cache = alepha.inject(ReactPageCacheProvider);
      const route = alepha.inject(ReactPageProvider).page("about");
      const keyOf = (url: string) => {
        const plan = cache.plan(route, {
          params: {},
          query: {},
          url: new URL(url),
        });
        return plan && "key" in plan ? plan.key : undefined;
      };

      expect(keyOf("http://a.example/about")).toBeTypeOf("string");
      expect(keyOf("http://a.example./about")).toBe(
        keyOf("http://a.example/about"),
      );
      expect(keyOf("http://A.Example.:8080/about")).toBe(
        keyOf("http://a.example:8080/about"),
      );
      expect(keyOf("http://b.example/about")).not.toBe(
        keyOf("http://a.example/about"),
      );

      await alepha.stop();
    });

    it("writes the same hreflang origin for a host and its trailing dot", async ({
      expect,
    }) => {
      const { alepha, base } = await start(App, {}, withLocales);

      const dotted = await get(base, "/about", "site.example.");
      expect(alternates(dotted)).toContain("http://site.example/fr/about");
      expect(alternates(dotted)).not.toContain("site.example./");

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
          // A plain Error on purpose: the shape of a database driver's.
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
      library = $page({
        path: "/library",
        loader: async () => {
          // What an HTTP library throws: a status, and a message never
          // written for a visitor.
          throw Object.assign(new Error("GET https://internal/hunter2 404"), {
            status: 404,
          });
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
          // Plain Errors on purpose: what a driver and an HTTP library throw.
          value: Promise.reject(new Error("db: password=hunter2")),
          refused: Promise.reject(
            new HttpError({ status: 404 }, { message: "No such order" }),
          ),
          library: Promise.reject(
            Object.assign(new Error("GET https://internal/hunter2 404"), {
              status: 404,
            }),
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

    it("hides the message of a 4xx that is not an HttpError, and keeps its status", async ({
      expect,
    }) => {
      const { alepha, base } = await start(App, production);

      const html = await get(base, "/library");
      expect(html).not.toContain("hunter2");
      expect(payload(html)["alepha.react.router.layers"][0].error).toEqual({
        name: "Error",
        message: "Internal Server Error",
        status: 404,
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
      expect(props.library.$deferred).toEqual({
        status: "rejected",
        error: { name: "Error", message: "Internal Server Error", status: 404 },
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

  describe("a constant head script under a CSP", () => {
    const hashOf = (body: string) =>
      `'sha256-${createHash("sha256").update(body).digest("base64")}'`;

    const visit = async (alepha: Alepha, base: string) => {
      const response = await fetch(`${base}/`);
      const html = await response.text();
      await alepha.inject(BackgroundTaskProvider).flush();
      return {
        html,
        cache: response.headers.get("x-alepha-cache"),
        csp: response.headers.get("content-security-policy") ?? "",
      };
    };

    for (const [what, content, written] of [
      ["an ordinary one", "window.__plain=1", "window.__plain=1"],
      [
        "one the escape rewrites",
        'window.__closing="</script>"',
        'window.__closing="\\u003c/script>"',
      ],
    ] as const) {
      it(`keeps ${what} on its hash, and the page in the cache`, async ({
        expect,
      }) => {
        class App {
          head = $head({ script: [{ content }] });
          home = $page({ path: "/", component: () => <b>home</b> });
        }

        const { alepha, base } = await start(App, {}, (alepha) => {
          alepha.store.mut(helmetOptions, (old) => ({
            ...old,
            contentSecurityPolicy: {},
          }));
          alepha.store.mut(reactPageCacheOptions, (it) => ({
            ...it,
            anonymousCheck: false,
          }));
        });

        const first = await visit(alepha, base);
        const second = await visit(alepha, base);
        const third = await visit(alepha, base);

        expect(first.cache).toBe("miss");
        expect(second.cache).toBe("hit; verdict=shared");
        expect(third.cache).toBe("hit; verdict=shared");
        for (const { html, csp } of [first, second, third]) {
          // The bytes on the page, with no nonce, and their hash in the
          // policy: what the browser compares.
          expect(html).toContain(`<script >${written}</script>`);
          expect(csp).toContain(hashOf(written));
        }

        await alepha.stop();
      });
    }
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

    it("keeps a data block that is not JSON as it was written", ({
      expect,
    }) => {
      const view = "<div>{{ a < b }}</div>\u2028";
      const shader = "void main() { if (a < b) discard; }";
      const html = template().renderHeadContent({
        script: [
          { type: "text/template", content: view },
          { type: "x-shader/x-fragment", content: shader },
        ],
      });

      expect(html).toContain(`<script type="text/template">${view}</script>`);
      expect(html).toContain(
        `<script type="x-shader/x-fragment">${shader}</script>`,
      );
    });

    it("still cannot be closed by a data block that is not JSON", ({
      expect,
    }) => {
      const html = template().renderHeadContent({
        script: [
          {
            type: "text/template",
            content: "<p></script><script>alert(1)</script></p>",
          },
        ],
      });

      expect(html.match(/<\/script>/g)).toHaveLength(1);
    });

    it("reads every JSON type as JSON", ({ expect }) => {
      const provider = template();
      for (const type of [
        "application/json",
        "application/ld+json",
        "application/ld+json; charset=utf-8",
        "APPLICATION/MANIFEST+JSON",
        "importmap",
        "speculationrules",
      ]) {
        expect(provider.escapeInlineScript('{"a":"<b>"}', type), type).toBe(
          '{"a":"\\u003cb>"}',
        );
      }
    });

    it("escapes the same way when it runs twice", ({ expect }) => {
      const provider = template();
      for (const [type, content] of [
        ["application/ld+json", '{"a":"</script>\u2028"}'],
        ["text/template", "<p></script><!--<script>"],
        [undefined, 'var a = "</script><!--<script>";'],
      ] as const) {
        const once = provider.escapeInlineScript(content, type);
        expect(provider.escapeInlineScript(once, type)).toBe(once);
      }
    });

    it("cannot be closed by a literal </script in code", ({ expect }) => {
      const html = template().renderHeadContent({
        script: [
          'var a = "</script><script>alert(1)</script>";',
          { content: 'var b = "</SCRIPT >";' },
        ],
      });

      expect(html.match(/<\/script/gi)).toHaveLength(2);
      expect(html).toContain(
        'var a = "\\u003c/script><script>alert(1)\\u003c/script>";',
      );
      expect(html).toContain('var b = "\\u003c/SCRIPT >";');
    });

    it("rewrites <!-- in code only where it would hide the closing tag", ({
      expect,
    }) => {
      const provider = template();

      // An operator sequence in a module, a comment in a classic script:
      // either way the element still ends at its closing tag.
      expect(provider.escapeInlineScript("if (a<!--b) { go(); }")).toBe(
        "if (a<!--b) { go(); }",
      );
      // Followed by `<script`, the parser stops seeing `</script>`.
      expect(provider.escapeInlineScript('var a = "<!--<script>";')).toBe(
        'var a = "\\u003c!--<script>";',
      );
    });

    it("leaves ordinary code alone", ({ expect }) => {
      const html = template().renderHeadContent({
        script: ["if (a < b && c > d) { go(); }"],
      });

      expect(html).toContain("<script>if (a < b && c > d) { go(); }</script>");
    });
  });
});
