import { Alepha } from "alepha";
import { $page } from "alepha/react/router";
import { HttpClient, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

describe("$page can() access control", () => {
  it("should return 403 when leaf page can() returns false", async ({
    expect,
  }) => {
    class App {
      home = $page({
        path: "/forbidden",
        can: () => false,
        component: () => "Should not render",
      });
    }

    const alepha = Alepha.create();
    alepha.with(App);
    await alepha.start();

    const server = alepha.inject(ServerProvider);
    const http = alepha.inject(HttpClient);
    const response = await http.fetch(`${server.hostname}/forbidden`);

    expect(response.status).toBe(403);
    expect(response.data).toBe("Forbidden");
  });

  it("should return 403 when parent page can() returns false", async ({
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

    expect(response.status).toBe(403);
    expect(response.data).toBe("Forbidden");
  });

  it("should allow access when all can() in parent chain return true", async ({
    expect,
  }) => {
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
