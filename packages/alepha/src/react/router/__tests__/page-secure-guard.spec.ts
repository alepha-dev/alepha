import { Alepha, createMiddleware, type Middleware } from "alepha";
import { $secure } from "alepha/security";
import { describe, expect, it } from "vitest";
import { AlephaReactRouter } from "../index.ts";
import { $page } from "../primitives/$page.ts";

/**
 * `$secure` on a page is a real guard, and these pin the two halves of that.
 *
 * The router does not inspect what a middleware returned — it tracks whether
 * `next` was ever called. So a guard denies by short-circuiting, and the router
 * turns that into a redirect (anonymous) or a 403 (authenticated) instead of
 * rendering the page without its data.
 *
 * This file replaces a spec that asserted the opposite: a boot warning claiming
 * `$secure` "does not prevent it from rendering". That warning was added months
 * after client-side enforcement landed and described behaviour that no longer
 * existed on either path.
 */
const setup = () => Alepha.create().with(AlephaReactRouter);

/**
 * Denies by returning without calling `next` — the shape `$secure` and `$owns`
 * both take in the browser.
 */
const $deny = (): Middleware =>
  createMiddleware({ name: "$deny", handler: () => async () => undefined });

describe("$page + $secure", () => {
  it("refuses to render a guarded page instead of crashing", async () => {
    const alepha = setup();

    class GuardedRouter {
      login = $page({ path: "/login", name: "login", component: () => null });
      admin = $page({
        path: "/admin",
        use: [$deny()],
        loader: () => ({ secret: "TOP SECRET" }),
        component: () => null,
      });
    }

    const app = alepha.inject(GuardedRouter);
    await alepha.start();

    const result = await app.admin.render();

    // Anonymous visitor → bounced to login carrying the blocked URL.
    expect(result.redirect).toBe("/login?redirect=%2Fadmin");
    expect(result.html).toBe("");
    // Regression: this path used to throw `Cannot read properties of undefined
    // (reading 'redirect')` — neither a denial nor a render.
    expect(result.html).not.toContain("TOP SECRET");
  });

  it("throws 401 when a guarded page has no login route to fall back on", async () => {
    const alepha = setup();

    class NoLoginRouter {
      admin = $page({
        path: "/admin",
        use: [$deny()],
        component: () => null,
      });
    }

    const app = alepha.inject(NoLoginRouter);
    await alepha.start();

    await expect(app.admin.render()).rejects.toMatchObject({ status: 401 });
  });

  it("still renders a page whose guard admits the visitor", async () => {
    const alepha = setup();

    const $allow = (): Middleware =>
      createMiddleware({
        name: "$allow",
        handler:
          ({ next }) =>
          async (...args: any[]) =>
            next(...args),
      });

    class OpenRouter {
      home = $page({
        path: "/",
        use: [$allow()],
        loader: () => ({ msg: "visible" }),
        component: ({ msg }: { msg: string }) => msg,
      });
    }

    const app = alepha.inject(OpenRouter);
    await alepha.start();

    const result = await app.home.render();
    expect(result.html).toContain("visible");
    expect(result.redirect).toBeUndefined();
  });

  it("denies an anonymous visitor on the server with a real $secure", async () => {
    const alepha = setup();

    class SecureRouter {
      admin = $page({
        path: "/admin",
        use: [$secure({ permissions: ["admin:read"] })],
        loader: () => ({ secret: "TOP SECRET" }),
        component: () => null,
      });
    }

    const app = alepha.inject(SecureRouter);
    await alepha.start();

    // Server-side `$secure` throws rather than short-circuiting, which an app's
    // `errorHandler` converts into its own Redirection (as Lore does).
    await expect(app.admin.render()).rejects.toMatchObject({ status: 401 });
  });
});

describe("$page can() derived from $secure", () => {
  it("hides a guarded page from nav when the permission is missing", async () => {
    const alepha = setup();

    class App {
      reports = $page({
        path: "/reports",
        use: [$secure({ permissions: ["reports:read"] })],
        nav: { label: "Reports" },
        component: () => null,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const can = app.reports.options.can;
    expect(can).toBeDefined();
    expect(can?.({ has: () => false })).toBe(false);
    expect(can?.({ has: (p) => p === "reports:read" })).toBe(true);
  });

  it("requires ALL permissions, matching $secure's AND semantics", async () => {
    const alepha = setup();

    class App {
      page = $page({
        path: "/both",
        use: [$secure({ permissions: ["a:read", "b:read"] })],
        component: () => null,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const can = app.page.options.can;
    expect(can?.({ has: (p) => p === "a:read" })).toBe(false);
    expect(can?.({ has: () => true })).toBe(true);
  });

  it("never overrides a hand-written can()", async () => {
    const alepha = setup();

    class App {
      page = $page({
        path: "/explicit",
        use: [$secure({ permissions: ["x:read"] })],
        can: () => "disabled",
        component: () => null,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    // A derived predicate must never widen or narrow an explicit one.
    expect(app.page.options.can?.({ has: () => true })).toBe("disabled");
  });

  it("leaves an unguarded page without a can()", async () => {
    const alepha = setup();

    class App {
      home = $page({
        path: "/",
        nav: { label: "Home" },
        component: () => null,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    expect(app.home.options.can).toBeUndefined();
  });

  it("ignores a $secure that only checks roles", async () => {
    const alepha = setup();

    class App {
      page = $page({
        path: "/staff",
        use: [$secure({ roles: ["staff"] })],
        component: () => null,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    // `can` is a permission probe — there is nothing to derive from a role
    // list, and inventing one would hide the entry from everybody.
    expect(app.page.options.can).toBeUndefined();
  });
});
