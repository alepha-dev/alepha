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
});
