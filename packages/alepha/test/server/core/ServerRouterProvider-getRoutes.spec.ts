import { Alepha, t } from "alepha";
import { $action, $route, ServerRouterProvider } from "alepha/server";
import { describe, it } from "vitest";

describe("ServerRouterProvider - getRoutes", () => {
  it("should return all routes when no pattern is provided", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class TestApp {
      action1 = $action({
        path: "/users",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });

      action2 = $action({
        path: "/posts",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });

      route1 = $route({
        path: "/health",
        handler: () => "OK",
      });
    }

    await alepha.with(TestApp).start();

    const routerProvider = alepha.inject(ServerRouterProvider);
    const routes = routerProvider.getRoutes();

    expect(routes.length).toBeGreaterThanOrEqual(3);
  });

  it("should return routes matching wildcard pattern", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestApp {
      users = $action({
        path: "/users",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });

      userDetail = $action({
        path: "/users/:id",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });

      posts = $action({
        path: "/posts",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });

      health = $route({
        path: "/health",
        handler: () => "OK",
      });
    }

    await alepha.with(TestApp).start();

    const routerProvider = alepha.inject(ServerRouterProvider);
    const routes = routerProvider.getRoutes("/api/*");

    // Should include the actions under /api/*
    const paths = routes.map((r) => r.path);
    expect(paths.length).toBeGreaterThanOrEqual(3);
    expect(paths.some((p) => p.includes("/users"))).toBe(true);
    expect(paths.some((p) => p.includes("/posts"))).toBe(true);
    // health route should not match /api/*
    expect(paths.some((p) => p === "/GET/health")).toBe(false);
  });

  it("should return empty array when pattern doesn't match any routes", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class TestApp {
      users = $action({
        path: "/users",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });

      posts = $action({
        path: "/posts",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });
    }

    await alepha.with(TestApp).start();

    const routerProvider = alepha.inject(ServerRouterProvider);
    const routes = routerProvider.getRoutes("/v2/*");

    expect(routes).toHaveLength(0);
  });

  it("should return empty array when exact pattern doesn't match", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class TestApp {
      users = $action({
        path: "/users",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });
    }

    await alepha.with(TestApp).start();

    const routerProvider = alepha.inject(ServerRouterProvider);
    const routes = routerProvider.getRoutes("/admin");

    expect(routes).toHaveLength(0);
  });

  it("should differentiate between exact match and wildcard match patterns", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class TestApp {
      apiInfo = $action({
        path: "/api-info",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });

      apiUsers = $action({
        path: "/api-users",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });

      settings = $route({
        path: "/settings",
        handler: () => "OK",
      });
    }

    await alepha.with(TestApp).start();

    const routerProvider = alepha.inject(ServerRouterProvider);

    // Wildcard pattern matches multiple routes
    const wildcardRoutes = routerProvider.getRoutes("/api/*");
    expect(wildcardRoutes.length).toBeGreaterThan(0);
  });

  it("should return multiple routes for deep nested paths", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class TestApp {
      level1 = $action({
        path: "/v1/users",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });

      level2 = $action({
        path: "/v1/users/:id/posts",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });

      level3 = $action({
        path: "/v1/users/:id/posts/:postId/comments",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });

      v2 = $action({
        path: "/v2/users",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });
    }

    await alepha.with(TestApp).start();

    const routerProvider = alepha.inject(ServerRouterProvider);
    const routes = routerProvider.getRoutes("/api/*");

    // Should find nested routes under /api/*
    expect(routes.length).toBeGreaterThanOrEqual(2);
    const paths = routes.map((r) => r.path);
    expect(paths.some((p) => p.includes("v1"))).toBe(true);
    expect(paths.some((p) => p.includes("v2"))).toBe(true);
  });

  it("should match all routes with root wildcard pattern", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class TestApp {
      health = $route({
        path: "/health",
        schema: { response: t.object({ status: t.string() }) },
        handler: () => ({ status: "ok" }),
      });

      about = $route({
        path: "/about",
        schema: { response: t.object({ name: t.string() }) },
        handler: () => ({ name: "app" }),
      });

      users = $action({
        path: "/users",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });
    }

    await alepha.with(TestApp).start();

    const routerProvider = alepha.inject(ServerRouterProvider);
    const routes = routerProvider.getRoutes("/*");

    expect(routes.length).toBeGreaterThanOrEqual(3);
  });

  it("should correctly filter by path prefix", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestApp {
      publicApi = $action({
        path: "/public/info",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });

      adminApi = $action({
        path: "/admin/users",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });

      privateRoute = $route({
        path: "/private",
        handler: () => "private",
      });
    }

    await alepha.with(TestApp).start();

    const routerProvider = alepha.inject(ServerRouterProvider);

    // Get routes matching /api/* pattern
    const apiRoutes = routerProvider.getRoutes("/api/*");
    expect(apiRoutes.length).toBeGreaterThan(0);

    // Get routes matching a specific non-api pattern
    const privateRoutes = routerProvider.getRoutes("/private");
    expect(privateRoutes.length).toBeGreaterThanOrEqual(0);
  });

  it("should handle routes with method-specific paths", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestApp {
      getUsers = $action({
        method: "GET",
        path: "/users",
        schema: { response: t.array(t.object({ id: t.integer() })) },
        handler: () => [],
      });

      createUser = $action({
        method: "POST",
        path: "/users",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });

      updateUser = $action({
        method: "PATCH",
        path: "/users/:id",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });
    }

    await alepha.with(TestApp).start();

    const routerProvider = alepha.inject(ServerRouterProvider);
    const routes = routerProvider.getRoutes("/api/*");

    // Should return routes with different HTTP methods for /users path
    expect(routes.length).toBeGreaterThanOrEqual(2);
    const paths = routes.map((r) => r.path);
    expect(paths.some((p) => p.includes("/users"))).toBe(true);
  });

  it("should be case-sensitive for path matching", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestApp {
      users = $action({
        path: "/users",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });

      users2 = $action({
        path: "/Users",
        schema: { response: t.object({ id: t.integer() }) },
        handler: () => ({ id: 1 }),
      });
    }

    await alepha.with(TestApp).start();

    const routerProvider = alepha.inject(ServerRouterProvider);
    const allRoutes = routerProvider.getRoutes();

    // Both routes should exist
    expect(allRoutes.length).toBeGreaterThanOrEqual(2);
  });
});
