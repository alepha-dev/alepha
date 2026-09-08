import { Alepha, createMiddleware } from "alepha";
import { ServerProvider, UnauthorizedError } from "alepha/server";
import { describe, it } from "vitest";

import { AlephaReactRouter } from "../index.ts";
import { $page } from "../primitives/$page.ts";

/**
 * The catch-all page answers 404, whoever declared it.
 *
 * The framework treats `/*` as the not-found page everywhere: the built-in one
 * is skipped as soon as an app declares its own, and a denied guard falls back
 * to it. Only the status used to disagree, and precisely when an app cared
 * enough to design its own 404 page: the built-in carried the status, an
 * app-declared page replaced it wholesale, and the reply stayed 200.
 *
 * That is a soft 404, which is worse than no 404 page at all - a crawler
 * indexes it as a real page, and a security scanner reads it as a live
 * endpoint. It was live on alepha.dev, where `run_worker_first: ["/api/*"]`
 * sends every unmatched `/api/*` path through the worker: 256 probes for
 * `/api/credentials`, `/api/v1/secrets` and friends all came back 200.
 */
const start = async (App: new () => any) => {
  const alepha = Alepha.create({
    env: { SERVER_PORT: 0, APP_SECRET: "test-secret" },
  }).with(AlephaReactRouter);
  alepha.inject(App);
  await alepha.start();
  const hostname = alepha.inject(ServerProvider).hostname;

  return (path: string) => fetch(`${hostname}${path}`, { redirect: "manual" });
};

describe("$page not-found status", () => {
  it("answers 404 on the built-in catch-all", async ({ expect }) => {
    class App {
      home = $page({ path: "/", component: () => "home" });
    }

    const request = await start(App);
    const res = await request("/nope");

    expect(res.status).toBe(404);
  });

  it("answers 404 on an app-declared catch-all", async ({ expect }) => {
    class App {
      home = $page({ path: "/", component: () => "home" });
      notFound = $page({ path: "/*", component: () => "custom not found" });
    }

    const request = await start(App);
    const res = await request("/api/credentials");

    // The app's own design, and an honest status.
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("custom not found");
  });

  it("lets a catch-all keep its own status", async ({ expect }) => {
    class App {
      home = $page({ path: "/", component: () => "home" });
      // A `/*` that resolves real content - a CMS slug, a proxy - says so.
      catchAll = $page({
        path: "/*",
        component: () => "resolved",
        onServerResponse: ({ reply }) => {
          reply.status = 200;
        },
      });
    }

    const request = await start(App);
    const res = await request("/some/slug");

    expect(res.status).toBe(200);
  });

  /**
   * A file-like URL is refused before any page guard runs.
   *
   * Skipping SSR for `/wp-login.php` and friends was gated on the catch-all,
   * and a **root-level param** swallows exactly as much: `/:slug` matches
   * every unclaimed root segment, orphaned build assets included. Every deploy
   * renames those, so a browser holding the previous build asks for
   * `/chunk.OLD.js`, that lands on `/:slug`, and the page's `$secure()`
   * answers it as an authorization question: a login redirect for a visitor,
   * and on lore.alepha.dev a 403 "Access denied" for a signed-in one.
   *
   * The check therefore belongs OUTSIDE the middleware chain, not inside the
   * render it used to sit in: a guard that has already run has already given
   * the wrong answer.
   */
  it("answers a file-like URL before a root param page's guard runs", async ({
    expect,
  }) => {
    let guarded = 0;

    class App {
      // Stands in for `$secure()`: it refuses everyone, so any response other
      // than a plain 404 proves the guard was reached.
      deny = createMiddleware({
        name: "deny",
        handler: () =>
          (async () => {
            guarded++;
            throw new UnauthorizedError("nope");
          }) as any,
      });

      home = $page({ path: "/", component: () => "home" });
      slug = $page({
        path: "/:slug",
        use: [this.deny],
        component: () => "project",
      });
      notFound = $page({ path: "/*", component: () => "custom not found" });
    }

    const request = await start(App);

    const asset = await request("/chunk.CBi8gfGt.js");
    expect(asset.status).toBe(404);
    expect(asset.headers.get("content-type")).toContain("text/plain");
    expect(guarded).toBe(0);

    // A real slug is untouched: it has no extension, so the guard still owns it.
    const page = await request("/my-project");
    expect(guarded).toBe(1);
    expect(page.status).not.toBe(404);
  });

  it("still skips a file-like URL on the catch-all", async ({ expect }) => {
    class App {
      home = $page({ path: "/", component: () => "home" });
      notFound = $page({ path: "/*", component: () => "custom not found" });
    }

    const request = await start(App);
    const res = await request("/wp-login.php");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).not.toContain("custom not found");
  });

  it("leaves a matched page alone", async ({ expect }) => {
    class App {
      home = $page({ path: "/", component: () => "home" });
      notFound = $page({ path: "/*", component: () => "custom not found" });
    }

    const request = await start(App);
    const res = await request("/");

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("home");
  });
});
