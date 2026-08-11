import { $inject, Alepha } from "alepha";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { describe, expect, it } from "vitest";
import { AdminRouter } from "../admin-router.tsx";

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
      .map((page) => ({ path: page.options.path, name: page.options.name }));
  };

  it("mounts the shell and its ten pages", async () => {
    const pages = await mount();

    expect(pages).toEqual(
      expect.arrayContaining([
        { path: "/admin", name: "admin" },
        { path: "/users", name: undefined },
        { path: "/users/:userId", name: undefined },
        { path: "/sessions", name: undefined },
        { path: "/keys", name: undefined },
        { path: "/jobs", name: undefined },
        { path: "/notifications", name: undefined },
        { path: "/audits", name: undefined },
        { path: "/files", name: undefined },
        { path: "/parameters", name: undefined },
        { path: "/payments", name: undefined },
      ]),
    );
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

    const can = router.audits.options.can;
    expect(can).toBeDefined();

    // The audits module is registered: the entry belongs in the sidebar.
    expect(can!({ has: () => true })).toBe(true);

    // It is not: `findAudits` is absent from /api/_links, so the entry goes.
    // `admin:audit:read` still answers true here on purpose — this page's own
    // `$secure` declares it, which is exactly why the permission alone cannot
    // be the gate.
    expect(can!({ has: (name) => name !== "findAudits" })).toBe(false);
  });

  it("gates every admin page on an action, not only a permission", async () => {
    const alepha = Alepha.create().with(AlephaReactRouter);
    const router = alepha.inject(AdminRouter);
    await alepha.start();

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
    ];

    for (const page of pages) {
      expect(page.options.can).toBeDefined();
      // Simulate the `*`-wildcard admin from the bug report: every
      // permission-shaped name (colon in it) is granted, but no action name
      // is. A `can` derived only from `permission` (e.g. via `$page`'s
      // `deriveCanFromGuards` fallback) would answer `true` here, since the
      // permission it checks is exactly the kind of name this `has` grants —
      // which is why this must go false, and only does because `requires` is
      // wired in independently of `permission`.
      expect(page.options.can!({ has: (name) => name.includes(":") })).toBe(
        false,
      );
    }
  });
});
