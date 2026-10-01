import { Alepha } from "alepha";
import { HttpClient, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { $page } from "../index.ts";

/**
 * `$page.can` is a UI-only navigation predicate (sidebar visibility / disabled
 * state, command palette) — NOT a route access gate. It is intentionally not
 * consulted by the server renderer or the browser router: a `can` that only
 * blocked SSR (and not client-side navigation) would be an inconsistent,
 * bypassable gate. Real access control is `use: [$secure({ permissions })]`,
 * which runs in the loader pipeline on both server and client.
 *
 * These tests pin that contract: `can()` returning false must NOT block the
 * page from rendering.
 */
describe("$page can() is a UI-only predicate, not a route gate", () => {
  it("renders the page even when can() returns false", async ({ expect }) => {
    class App {
      home = $page({
        path: "/forbidden",
        can: () => false,
        component: () => "Rendered regardless of can()",
      });
    }

    const alepha = Alepha.create();
    alepha.with(App);
    await alepha.start();

    const server = alepha.inject(ServerProvider);
    const http = alepha.inject(HttpClient);
    const response = await http.fetch(`${server.hostname}/forbidden`);

    expect(response.status).toBe(200);
  });

  it("renders a child page even when a parent's can() returns false", async ({
    expect,
  }) => {
    class App {
      admin = $page({
        path: "/admin",
        can: () => false,
        component: ({ children }) => children,
      });

      dashboard = $page({
        path: "/dashboard",
        parent: this.admin,
        component: () => "Admin Dashboard",
      });
    }

    const alepha = Alepha.create();
    alepha.with(App);
    await alepha.start();

    const server = alepha.inject(ServerProvider);
    const http = alepha.inject(HttpClient);
    const response = await http.fetch(`${server.hostname}/admin/dashboard`);

    expect(response.status).toBe(200);
  });

  it("renders normally when can() returns true", async ({ expect }) => {
    class App {
      admin = $page({
        path: "/admin",
        can: () => true,
        component: ({ children }) => children,
      });

      dashboard = $page({
        path: "/dashboard",
        parent: this.admin,
        component: () => "Welcome",
      });
    }

    const alepha = Alepha.create();
    alepha.with(App);
    await alepha.start();

    const server = alepha.inject(ServerProvider);
    const http = alepha.inject(HttpClient);
    const response = await http.fetch(`${server.hostname}/admin/dashboard`);

    expect(response.status).toBe(200);
  });
});
