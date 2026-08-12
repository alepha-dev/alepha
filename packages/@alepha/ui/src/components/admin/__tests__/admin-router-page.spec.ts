import { Alepha } from "alepha";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { describe, expect, it } from "vitest";
import { AdminRouter } from "../admin-router.tsx";
import { adminPage } from "../admin-router-page.tsx";

/**
 * `adminPage` is the one-call form of "a page inside the shared admin shell".
 *
 * It exists because the alternative — injecting `AdminRouter` and writing
 * `parent: this.admin.layout` by hand — puts the rules of the composition
 * nowhere an author will read them.
 */
describe("adminPage", () => {
  it("mounts the page under the admin shell without the app wiring a parent", async () => {
    class ShopAdminRouter {
      products = adminPage({
        path: "/products",
        nav: { label: "Catalogue", group: "Commerce", order: 100 },
        component: () => "products",
      });
    }

    const alepha = Alepha.create().with(AlephaReactRouter);
    alepha.with(ShopAdminRouter);
    await alepha.start();

    const products = alepha
      .primitives($page)
      .find((page) => page.name === "products");

    expect(products).toBeDefined();
    expect(products!.options.parent).toBe(alepha.inject(AdminRouter).layout);
  });

  it("registers AdminRouter, so the app never mounts the shell itself", async () => {
    class ShopAdminRouter {
      products = adminPage({
        path: "/products",
        component: () => "products",
      });
    }

    const alepha = Alepha.create().with(AlephaReactRouter);
    alepha.with(ShopAdminRouter);
    await alepha.start();

    // The app registered only its own class. Declaring one admin page is what
    // brought the shell — and with it the built-in pages — into the container.
    const names = alepha.primitives($page).map((page) => page.name);
    expect(names).toContain("admin");
    expect(names).toContain("users");
  });
});
