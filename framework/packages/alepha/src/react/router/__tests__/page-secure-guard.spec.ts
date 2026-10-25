import { Alepha, createMiddleware, type Middleware } from "alepha";
import { $secure } from "alepha/security";
import { describe, expect, it } from "vitest";

import { loginRoutesAtom } from "../atoms/loginRoutesAtom.ts";
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

    // No `login` route to fall back on, so the denial stays an error.
    await expect(app.admin.render()).rejects.toMatchObject({ status: 401 });
  });

  /**
   * The two `$secure` variants disagree on how they refuse — the browser
   * returns, the server throws — and that disagreement used to reach the user:
   * the same URL redirected on a client-side navigation and answered a bare 401
   * on a hard load. A crawler or a pasted link got the 401.
   *
   * The page's `errorHandler` cannot cover it: on the server the middleware
   * chain wraps the whole render, which puts it outside the loop that owns
   * `errorHandler`.
   */
  it("sends an anonymous visitor to login when the server guard throws", async () => {
    const alepha = setup();

    class SecureRouter {
      login = $page({ path: "/login", name: "login", component: () => null });
      admin = $page({
        path: "/admin",
        use: [$secure()],
        loader: () => ({ secret: "TOP SECRET" }),
        component: () => null,
      });
    }

    const app = alepha.inject(SecureRouter);
    await alepha.start();

    const result = await app.admin.render();

    expect(result.redirect).toBe("/login?redirect=%2Fadmin");
    expect(result.html).toBe("");
    expect(result.html).not.toContain("TOP SECRET");
  });

  it("lets a non-401 error keep its own meaning", async () => {
    const alepha = setup();

    const $boom = (): Middleware =>
      createMiddleware({
        name: "$boom",
        handler: () => async () => {
          const error = new Error("upstream exploded") as Error & {
            status?: number;
          };
          error.status = 503;
          throw error;
        },
      });

    class App {
      login = $page({ path: "/login", name: "login", component: () => null });
      page = $page({ path: "/x", use: [$boom()], component: () => null });
    }

    const app = alepha.inject(App);
    await alepha.start();

    // Only 401 means "we do not know who you are". Anything else must not be
    // laundered into a login redirect.
    await expect(app.page.render()).rejects.toThrow("upstream exploded");
  });
});

/**
 * An application can serve two realms, and only one route can be called
 * `login`. Before `loginRoutesAtom` there was no way to say which door a
 * denied page belonged to, so every denial landed on whichever page held the
 * name: an expired back-office session sent an agent, who signs in with an
 * identifier, a password and a realm, to the citizen's email-and-password
 * form.
 */
describe("$page + $secure, two sign-in pages", () => {
  /**
   * Both doors, and a guarded page under each. `login` is deliberately absent
   * from this application: neither door is the conventional one, which is the
   * whole shape of the report.
   */
  class TwoDoors {
    agent = $page({
      path: "/admin/sign-in",
      name: "agent",
      component: () => null,
    });
    signIn = $page({ path: "/sign-in", name: "signIn", component: () => null });
    backOffice = $page({
      path: "/admin/reports",
      use: [$deny()],
      component: () => null,
    });
    account = $page({
      path: "/account",
      use: [$deny()],
      component: () => null,
    });
  }

  const doors = [
    { prefix: "/admin", route: "agent" },
    { prefix: "/", route: "signIn" },
  ];

  it("sends a denied back-office page to the back-office door", async () => {
    const alepha = setup();
    const app = alepha.inject(TwoDoors);
    await alepha.start();
    alepha.store.set(loginRoutesAtom, doors);

    const result = await app.backOffice.render();

    expect(result.redirect).toBe("/admin/sign-in?redirect=%2Fadmin%2Freports");
  });

  it("sends everything else to the catch-all door beside it", async () => {
    const alepha = setup();
    const app = alepha.inject(TwoDoors);
    await alepha.start();
    alepha.store.set(loginRoutesAtom, doors);

    const result = await app.account.render();

    // The `/` entry is last, so the specific prefix above it still won the
    // test before this one: first match wins, it is not longest-match.
    expect(result.redirect).toBe("/sign-in?redirect=%2Faccount");
  });

  it("falls back to `login` for a URL under no declared prefix", async () => {
    const alepha = setup();

    class OneDoorPlusLogin {
      login = $page({ path: "/login", name: "login", component: () => null });
      agent = $page({
        path: "/admin/sign-in",
        name: "agent",
        component: () => null,
      });
      account = $page({
        path: "/account",
        use: [$deny()],
        component: () => null,
      });
    }

    const app = alepha.inject(OneDoorPlusLogin);
    await alepha.start();
    // No catch-all entry, so `/account` matches nothing here.
    alepha.store.set(loginRoutesAtom, [{ prefix: "/admin", route: "agent" }]);

    const result = await app.account.render();

    expect(result.redirect).toBe("/login?redirect=%2Faccount");
  });

  /**
   * A typo in the list must degrade to the behaviour of an application that
   * never set it, rather than to a redirect pointing at nothing. The list is
   * hand-written data and nothing typechecks a route name.
   */
  it("falls back to `login` when a prefix names a route that does not exist", async () => {
    const alepha = setup();

    class Typo {
      login = $page({ path: "/login", name: "login", component: () => null });
      backOffice = $page({
        path: "/admin/reports",
        use: [$deny()],
        component: () => null,
      });
    }

    const app = alepha.inject(Typo);
    await alepha.start();
    alepha.store.set(loginRoutesAtom, [{ prefix: "/admin", route: "agnet" }]);

    const result = await app.backOffice.render();

    expect(result.redirect).toBe("/login?redirect=%2Fadmin%2Freports");
  });

  it("still throws 401 when neither the list nor `login` resolves", async () => {
    const alepha = setup();

    class NoDoor {
      backOffice = $page({
        path: "/admin/reports",
        use: [$deny()],
        component: () => null,
      });
    }

    const app = alepha.inject(NoDoor);
    await alepha.start();
    alepha.store.set(loginRoutesAtom, [{ prefix: "/admin", route: "agent" }]);

    await expect(app.backOffice.render()).rejects.toMatchObject({
      status: 401,
    });
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
