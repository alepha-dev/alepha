import { Alepha } from "alepha";
import { ServerProvider } from "alepha/server";
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
