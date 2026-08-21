import {
  $hook,
  Alepha,
  AlephaError,
  createMiddleware,
  type Middleware,
} from "alepha";
import { $action, HttpError, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { Redirection } from "../errors/Redirection.ts";
import { AlephaReactRouter } from "../index.ts";
import { $page } from "../primitives/$page.ts";

/**
 * A failure thrown *around* the render — a `use:` middleware, or any
 * `server:onRequest` hook — never reaches `createLayers`, so it never reaches
 * the page's `errorHandler` either. It used to fall through to
 * `ServerRouterProvider`, which answers JSON.
 *
 * That is correct for an API and wrong for a hard navigation: a visitor who
 * arrives while the app is still booting, or who trips the rate limiter, got
 * `{"status":503,…}` as text on a white page.
 *
 * These pin both halves: a browser (`Accept: text/html`) gets a rendered
 * document through the page's own error handling, and every programmatic
 * caller keeps the JSON it relies on.
 */
const $throwing = (error: Error): Middleware =>
  createMiddleware({
    name: "$throwing",
    handler: () => async () => {
      throw error;
    },
  });

const HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

const start = async (App: new () => any, env: Record<string, any> = {}) => {
  const alepha = Alepha.create({
    env: { SERVER_PORT: 0, APP_SECRET: "test-secret", ...env },
  }).with(AlephaReactRouter);
  alepha.inject(App);
  await alepha.start();
  const hostname = alepha.inject(ServerProvider).hostname;

  return (path: string, accept?: string) =>
    fetch(`${hostname}${path}`, {
      headers: accept ? { accept } : {},
      redirect: "manual",
    });
};

describe("$page html errors", () => {
  it("renders a document for a browser navigation", async ({ expect }) => {
    class App {
      home = $page({ path: "/", component: () => "home" });
      boom = $page({
        path: "/boom",
        use: [$throwing(new HttpError({ status: 503, message: "booting" }))],
        component: () => "never",
      });
    }

    const get = await start(App);
    const res = await get("/boom", HTML);

    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<div id="root">');
    expect(html).toContain("booting");
  });

  it("keeps JSON for every programmatic caller", async ({ expect }) => {
    class App {
      home = $page({ path: "/", component: () => "home" });
      boom = $page({
        path: "/boom",
        use: [$throwing(new HttpError({ status: 429, message: "slow down" }))],
        component: () => "never",
      });
    }

    const get = await start(App);

    // `fetch()` defaults to `*/*`; a wildcard must never be read as "wants a
    // document", or every API call would start returning HTML.
    for (const accept of [undefined, "*/*", "application/json"]) {
      const res = await get("/boom", accept);
      expect(res.status).toBe(429);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect((await res.json()).message).toBe("slow down");
    }
  });

  it("renders the page's own errorHandler", async ({ expect }) => {
    class App {
      home = $page({ path: "/", component: () => "home" });
      boom = $page({
        path: "/boom",
        use: [$throwing(new HttpError({ status: 429, message: "slow down" }))],
        errorHandler: (error) =>
          HttpError.is(error, 429) ? (
            <div>Please wait a moment</div>
          ) : undefined,
        component: () => "never",
      });
    }

    const get = await start(App);
    const html = await (await get("/boom", HTML)).text();

    expect(html).toContain("Please wait a moment");
  });

  it("inherits a parent's errorHandler", async ({ expect }) => {
    class App {
      home = $page({ path: "/", component: () => "home" });
      layout = $page({
        path: "/app",
        errorHandler: () => <div>Handled by the layout</div>,
        component: () => "layout",
        children: () => [this.child],
      });
      child = $page({
        path: "/child",
        use: [$throwing(new AlephaError("boom"))],
        component: () => "never",
      });
    }

    const get = await start(App);
    const res = await get("/app/child", HTML);

    expect(res.status).toBe(500);
    expect(await res.text()).toContain("Handled by the layout");
  });

  it("lets an errorHandler redirect instead of rendering", async ({
    expect,
  }) => {
    class App {
      home = $page({ path: "/", component: () => "home" });
      boom = $page({
        path: "/boom",
        use: [$throwing(new HttpError({ status: 402, message: "pay up" }))],
        errorHandler: () => new Redirection("/pricing"),
        component: () => "never",
      });
    }

    const get = await start(App);
    const res = await get("/boom", HTML);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/pricing");
  });

  it("falls back to the built-in viewer when no handler applies", async ({
    expect,
  }) => {
    class App {
      home = $page({ path: "/", component: () => "home" });
      boom = $page({
        path: "/boom",
        use: [$throwing(new AlephaError("Middleware crash"))],
        // Declines this error, so the built-in viewer answers.
        errorHandler: () => undefined,
        component: () => "never",
      });
    }

    const get = await start(App);
    const res = await get("/boom", HTML);

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("text/html");
    // The dev viewer shows the error and its stack.
    expect(await res.text()).toContain("Middleware crash");
  });

  it("hides the message behind the production card", async ({ expect }) => {
    class App {
      home = $page({ path: "/", component: () => "home" });
      boom = $page({
        path: "/boom",
        use: [
          $throwing(
            new AlephaError("postgres://user:hunter2@db.internal refused"),
          ),
        ],
        component: () => "never",
      });
    }

    const get = await start(App, { NODE_ENV: "production" });
    const res = await get("/boom", HTML);
    const html = await res.text();

    expect(res.status).toBe(500);
    expect(html).toContain("Something went wrong");
    expect(html).not.toContain("hunter2");
  });

  it("never ships the entry script on an error page", async ({ expect }) => {
    class App {
      home = $page({ path: "/", component: () => "home" });
      boom = $page({
        path: "/boom",
        use: [$throwing(new AlephaError("boom"))],
        component: () => "never",
      });
    }

    const get = await start(App);
    const res = await get("/boom", HTML);
    const html = await res.text();

    expect(res.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("<!DOCTYPE html>");
    // Booting the client here would let it render the very URL the server
    // refused, replacing the error with a working-looking page.
    expect(html).not.toContain('<script type="module"');
    expect(html).not.toContain('id="__ssr"');
  });

  it("covers a server:onRequest hook, not just page middleware", async ({
    expect,
  }) => {
    class App {
      home = $page({ path: "/", component: () => "home" });

      /**
       * The shape `ServerNotReadyProvider` and `ServerRateLimitProvider` take.
       * These run before the route handler, so `withGuardDenial` never sees
       * them — they were the JSON that reached a real first-time visitor.
       */
      notReady = $hook({
        on: "server:onRequest",
        priority: "first",
        handler: () => {
          throw new HttpError({
            status: 503,
            message: "Server is not ready yet.",
          });
        },
      });
    }

    const get = await start(App);
    const res = await get("/", HTML);

    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<!DOCTYPE html>");
  });

  it("answers an API route in HTML when a browser asks for one", async ({
    expect,
  }) => {
    class App {
      home = $page({ path: "/", component: () => "home" });
      broken = $action({
        handler: () => {
          throw new AlephaError("api boom");
        },
      });
    }

    const get = await start(App);

    // Clicking a link to an endpoint is a navigation like any other, so it
    // gets a document. There is no page behind it, so it gets the built-in one.
    const page = await get("/api/broken", HTML);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("<!DOCTYPE html>");

    // The same endpoint called as an API is untouched.
    const api = await get("/api/broken");
    expect(api.headers.get("content-type")).toContain("application/json");
  });

  it("leaves a non-page route alone apart from the content type", async ({
    expect,
  }) => {
    class App {
      home = $page({ path: "/", component: () => "home" });
    }

    const get = await start(App);
    const res = await get("/", HTML);

    // The happy path must be untouched: a page that renders is still a page.
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("home");
  });
});
