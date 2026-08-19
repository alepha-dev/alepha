import { $inject, Alepha, OPTIONS } from "alepha";
import {
  $page,
  AlephaReactRouter,
  type PagePrimitive,
} from "alepha/react/router";
import { describe, expect, it } from "vitest";
import { AdminRouter } from "../admin-router.tsx";

/**
 * Reads the permission(s) a page's route gate actually enforces, the same
 * way `PagePrimitive.deriveCanFromGuards` does: walk `options.use`, find the
 * `$secure` middleware by its structural name (`alepha/react/router` cannot
 * import `alepha/security` to compare types), and read the permissions off
 * its metadata. Reading it back this way — rather than re-reading
 * `options.permission`, the value a page was built from — is what makes the
 * test catch a page whose `permission` was dropped: the route gate is the
 * thing that would actually change.
 */
const permissionsOf = (page: PagePrimitive): string[] => {
  const required: string[] = [];
  for (const middleware of page.options.use ?? []) {
    const metadata = middleware[OPTIONS];
    if (metadata?.name !== "$secure") {
      continue;
    }
    const permissions = (
      metadata.options as
        | { permissions?: Array<string | { name: string }> }
        | undefined
    )?.permissions;
    for (const permission of permissions ?? []) {
      required.push(
        typeof permission === "string" ? permission : permission.name,
      );
    }
  }
  return required;
};

/**
 * Registering `AdminRouter` must be the whole integration.
 *
 * Paths and names are asserted literally because they are a contract, not an
 * implementation detail. `$secure`'s redirect and `ButtonUser` both push a
 * route called `login`; `NavShell root="admin"` and `Spotlight root="admin"`
 * both anchor on the layout being named `admin`; and an application hanging
 * its own pages off this shell writes `/admin/...` paths against these.
 *
 * `:userId` rather than `:id` is deliberate. Param names must be unique
 * across the whole route table — two routes with different param names at the
 * same position silently lose the inner value — and `:id` is the name an
 * application is most likely to collide with.
 */
describe("AdminRouter", () => {
  const mount = async () => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    alepha.inject(AdminRouter);
    await alepha.start();
    return alepha
      .primitives($page)
      .map((page) => ({ path: page.options.path, name: page.name }));
  };

  it("mounts the shell and its twelve pages", async () => {
    const pages = await mount();

    expect(pages).toEqual(
      expect.arrayContaining([
        { path: "/admin", name: "admin" },
        { path: "/", name: "dashboard" },
        { path: "/users", name: "users" },
        { path: "/users/:userId", name: "userDetail" },
        { path: "/sessions", name: "sessions" },
        { path: "/keys", name: "keys" },
        { path: "/jobs", name: "jobs" },
        { path: "/notifications", name: "notifications" },
        { path: "/audits", name: "audits" },
        { path: "/files", name: "files" },
        { path: "/parameters", name: "parameters" },
        { path: "/payments", name: "payments" },
        { path: "/analytics", name: "analytics" },
      ]),
    );
  });

  it("gates every page on its documented permission", async () => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    const router = alepha.inject(AdminRouter);
    await alepha.start();

    const expected: Array<[PagePrimitive, string[]]> = [
      [router.users, ["admin:user:read"]],
      [router.userDetail, ["admin:user:read"]],
      [router.sessions, ["admin:session:read"]],
      [router.keys, ["admin:api-key:read"]],
      [router.jobs, ["admin:job:read"]],
      [router.notifications, ["admin:notification:read"]],
      [router.audits, ["admin:audit:read"]],
      [router.files, ["admin:file:read"]],
      [router.parameters, ["admin:parameter:read"]],
      [router.payments, ["admin:payment:read", "payments:read"]],
      [router.analytics, ["admin:analytics:read"]],
    ];

    for (const [page, permissions] of expected) {
      expect(permissionsOf(page)).toEqual(permissions);
    }
  });

  it("never uses :id as a param name", async () => {
    const pages = await mount();
    expect(pages.map((it) => it.path)).not.toContain("/users/:id");
  });

  it("lets an application hang its own page off the shell", async () => {
    class ShopAdminRouter {
      protected readonly admin = $inject(AdminRouter);

      products = $page({
        parent: this.admin.layout,
        path: "/products",
        nav: { label: "Catalogue", group: "Commerce", order: 100 },
        component: () => "products",
      });
    }

    const alepha = Alepha.create().with(AlephaReactRouter);
    alepha.inject(AdminRouter);
    alepha.with(ShopAdminRouter);
    await alepha.start();

    const products = alepha
      .primitives($page)
      .find((page) => page.name === "products");

    expect(products).toBeDefined();
    expect(products!.options.parent).toBe(alepha.inject(AdminRouter).layout);
  });

  it("hides a page whose backing action the server does not offer", async () => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    const router = alepha.inject(AdminRouter);
    await alepha.start();

    // Seed the link registry `can` actually consults: `findUsers` is
    // registered, `findAudits` deliberately is not.
    alepha.store.set("alepha.server.request.apiLinks", {
      actions: {
        findUsers: { path: "/users" },
      },
    });

    const usersCan = router.users.options.can;
    const auditsCan = router.audits.options.can;
    expect(usersCan).toBeDefined();
    expect(auditsCan).toBeDefined();

    // `has: () => true` is deliberate: it proves the permission side cannot
    // rescue either entry, since `can` now consults `LinkProvider` directly
    // and ignores the context it is called with entirely.
    //
    // The users module is registered: the entry belongs in the sidebar.
    expect(usersCan!({ has: () => true })).toBe(true);

    // The audits module is not: `findAudits` is absent from the registry, so
    // the entry goes — even though `admin:audit:read` (a permission-shaped
    // name) would be granted here, which is exactly why the permission alone
    // can never be the gate.
    expect(auditsCan!({ has: () => true })).toBe(false);
  });

  it("gates every admin page on an action, not only a permission", async () => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    const router = alepha.inject(AdminRouter);
    await alepha.start();

    // An empty registry: no action exists for any page to be granted.
    alepha.store.set("alepha.server.request.apiLinks", { actions: {} });

    const pages = [
      router.users,
      router.userDetail,
      router.sessions,
      router.keys,
      router.jobs,
      router.notifications,
      router.audits,
      router.files,
      router.parameters,
      router.payments,
      router.analytics,
    ];

    for (const page of pages) {
      expect(page.options.can).toBeDefined();
      // Simulate the `*`-wildcard admin from the bug report: every
      // permission-shaped name (colon in it) is granted, but no action name
      // is. A `can` derived only from `permission` (e.g. via `$page`'s
      // `deriveCanFromGuards` fallback) would answer `true` here, since the
      // permission it checks is exactly the kind of name this `has` grants —
      // which is why this must go false, and only does because `can` is
      // wired to a `$client` action independently of `permission`.
      expect(page.options.can!({ has: (name) => name.includes(":") })).toBe(
        false,
      );
    }
  });

  /**
   * The band is the whole mechanism behind "an application's own pages come
   * first". `useNavEntries` sorts groups by their smallest member, so the
   * built-ins staying at 1000 and up is what lets a `Commerce` or `Lore`
   * group at the conventional `order: 100` lead without configuring
   * anything. Renumber one entry down into the low hundreds and every
   * consumer's sidebar silently reshuffles.
   */
  it("parks every built-in nav entry in the reserved 1000+ band", async () => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    alepha.inject(AdminRouter);
    await alepha.start();

    const grouped = alepha
      .primitives($page)
      .map((page) => page.options.nav)
      .filter((nav) => nav?.group !== undefined);

    expect(grouped.length).toBeGreaterThan(0);
    for (const nav of grouped) {
      expect(nav!.order).toBeGreaterThanOrEqual(1000);
      expect(["Identity", "System"]).toContain(nav!.group);
    }
  });

  it("leads with an ungrouped dashboard", async () => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    const router = alepha.inject(AdminRouter);
    await alepha.start();

    // The shell root itself, not a child URL: a bare `/admin` resolves to
    // the dashboard rather than redirecting to a second one. Same arrangement
    // `AccountRouter` uses for `/account`, and the reason the `indexPath`
    // option no longer exists.
    expect(router.dashboard.options.path).toBe("/");
    expect(router.dashboard.options.parent).toBe(router.layout);
    // Nothing may reintroduce an index redirect behind its back.
    expect(router.layout.options.loader).toBeUndefined();

    const nav = router.dashboard.options.nav;
    // No group puts it in `useNavEntries`' `""` bucket, whose groupOrder is
    // its smallest member — 0, ahead of every real group.
    expect(nav?.group).toBeUndefined();
    expect(nav?.order).toBe(0);

    // The one page deliberately exempt from the action gate asserted above.
    // It has no backing action of its own: reaching it already means holding
    // the layout's `admin:ui`, and it renders only cards that pass their own
    // `can`, so an administrator with nothing to read gets an empty state
    // rather than a locked door. Listed here so the exemption reads as a
    // decision rather than an omission.
    expect(router.dashboard.options.can).toBeUndefined();
  });
});
