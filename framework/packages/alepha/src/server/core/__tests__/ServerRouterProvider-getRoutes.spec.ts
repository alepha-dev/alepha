import { Alepha, z } from "alepha";
import { describe, it } from "vitest";

import { $action, $route, ServerRouterProvider } from "../index.ts";

class TestApp {
  users = $action({
    method: "GET",
    path: "/users",
    schema: { response: z.object({ id: z.integer() }) },
    handler: () => ({ id: 1 }),
  });

  userDetail = $action({
    method: "GET",
    path: "/users/:id",
    schema: { response: z.object({ id: z.integer() }) },
    handler: () => ({ id: 1 }),
  });

  createUser = $action({
    method: "POST",
    path: "/users",
    schema: { response: z.object({ id: z.integer() }) },
    handler: () => ({ id: 1 }),
  });

  nested = $action({
    method: "GET",
    path: "/v1/users/:id/posts",
    schema: { response: z.object({ id: z.integer() }) },
    handler: () => ({ id: 1 }),
  });

  about = $route({
    path: "/about",
    handler: () => "about",
  });

  apiRoot = $route({
    path: "/api",
    handler: () => "root",
  });
}

describe("ServerRouterProvider - getRoutes", () => {
  /**
   * The routes a pattern selects, as sorted `METHOD path` lines.
   */
  const select = async (pattern?: string) => {
    const alepha = Alepha.create().with(TestApp);
    await alepha.start();
    return alepha
      .inject(ServerRouterProvider)
      .getRoutes(pattern)
      .map((route) => `${route.method} ${route.path}`)
      .sort();
  };

  const actions = [
    "GET /api/users",
    "GET /api/users/:id",
    "GET /api/v1/users/:id/posts",
    "POST /api/users",
  ];

  it("should return every route when no pattern is given", async ({
    expect,
  }) => {
    const routes = await select();

    expect(routes).toEqual(
      expect.arrayContaining([...actions, "GET /about", "GET /api"]),
    );
    // The server's own routes are in the list too.
    expect(routes).toContain("GET /health");
  });

  it("should return what is under a wildcard prefix, and not the prefix itself", async ({
    expect,
  }) => {
    expect(await select("/api/*")).toEqual(actions);
  });

  it("should return several levels under a nested prefix", async ({
    expect,
  }) => {
    expect(await select("/api/users/*")).toEqual(["GET /api/users/:id"]);
    expect(await select("/api/v1/*")).toEqual(["GET /api/v1/users/:id/posts"]);
  });

  it("should return only the exact path for a pattern with no wildcard", async ({
    expect,
  }) => {
    expect(await select("/about")).toEqual(["GET /about"]);
    expect(await select("/api")).toEqual(["GET /api"]);
    // Every method declared on the path.
    expect(await select("/api/users")).toEqual([
      "GET /api/users",
      "POST /api/users",
    ]);
  });

  it("should return nothing for a pattern no route matches", async ({
    expect,
  }) => {
    expect(await select("/v2/*")).toEqual([]);
    expect(await select("/admin")).toEqual([]);
    // A longer first segment is another path.
    expect(await select("/ap/*")).toEqual([]);
  });

  it("should return every route for the root wildcard", async ({ expect }) => {
    expect(await select("/*")).toEqual(await select());
  });
});
