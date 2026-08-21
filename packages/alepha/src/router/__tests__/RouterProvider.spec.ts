import { describe, it } from "vitest";

import { RouterProvider } from "../providers/RouterProvider.ts";

interface TestRoute {
  name: string;
  path: string;
}

class TestRouterProvider extends RouterProvider<TestRoute> {
  public push(route: TestRoute) {
    super.push(route);
  }
}

const playground = () => {
  const router = new TestRouterProvider();
  const add = (path: string, name: string) => {
    router.push({
      path,
      name,
    });
  };

  const match = (path: string) => {
    const { route, params } = router.match(`${path}?a=b`);
    return {
      name: route?.name ?? "null",
      params: params,
    };
  };

  return {
    add,
    match,
    router,
  };
};

describe("RouterProvider", () => {
  it("should match routes with static paths, params, and wildcards", ({
    expect,
  }) => {
    const { add, match } = playground();

    add("/", "home");
    add("/about", "about");
    add("/dist/", "dist");
    add("/users", "users");
    add("/users/:name", "users-by-name");
    add("/users/:name/INFO", "users-by-name-info");
    add("/users/:name/x/y/z", "users-by-name-x-y-z");
    add("/useRs/:name/x/*", "users-by-name-x-not-found");
    add("/*", "not-found");

    expect(match("/")).toEqual({
      name: "home",
      params: {},
    });

    expect(match("/about")).toEqual({
      name: "about",
      params: {},
    });

    expect(match("/dist")).toEqual({
      name: "dist",
      params: {},
    });

    expect(match("/dist/")).toEqual({
      name: "dist",
      params: {},
    });

    expect(match("/users/jack")).toEqual({
      name: "users-by-name",
      params: {
        name: "jack",
      },
    });

    expect(match("/users/jack/info")).toEqual({
      name: "users-by-name-info",
      params: {
        name: "jack",
      },
    });

    // Falls all the way back to the root `/*`. The route that matched is
    // `/*`, so it gets the whole path as its capture — and `name`, captured
    // on the branch that was abandoned, is not part of it.
    expect(match("/users/jack/info/other")).toEqual({
      name: "not-found",
      params: {
        "*": "users/jack/info/other",
      },
    });

    // `/useRs/:name/x/*` matching its own prefix: the wildcard captured
    // nothing, which is an empty capture rather than a missing one.
    expect(match("/users/JACK/x")).toEqual({
      name: "users-by-name-x-not-found",
      params: {
        name: "JACK",
        "*": "",
      },
    });

    expect(match("/users/jack/x/y")).toEqual({
      name: "users-by-name-x-not-found",
      params: {
        name: "jack",
        "*": "y",
      },
    });

    expect(match("/users/jack/x/y/z")).toEqual({
      name: "users-by-name-x-y-z",
      params: {
        name: "jack",
      },
    });

    expect(match("/users/jack/x/abc/def")).toEqual({
      name: "users-by-name-x-not-found",
      params: {
        "*": "abc/def",
        name: "jack",
      },
    });

    expect(match("/weird")).toEqual({
      name: "not-found",
      params: {
        "*": "weird",
      },
    });
  });

  it("should return null for paths with no matching routes", ({ expect }) => {
    const { match } = playground();
    expect(match("/")).toEqual({
      name: "null",
      params: {},
    });
    expect(match("/abc/def")).toEqual({
      name: "null",
      params: {},
    });
  });

  it("should throw error for invalid path formats", ({ expect }) => {
    const { match } = playground();
    expect(() => match("x")).toThrowError();
    expect(() => match("(*__*)")).toThrowError();
  });

  it("should match only wildcard route", ({ expect }) => {
    const { add, match } = playground();
    add("/*", "wildcard");
    expect(match("/")).toEqual({
      name: "wildcard",
      params: {
        "*": "",
      },
    });
  });

  it("should throw error when adding invalid path", ({ expect }) => {
    const { add } = playground();
    expect(() => add("*", "wildcard")).toThrowError();
  });

  it("should handle routes with params and wildcard", ({ expect }) => {
    const { add, match } = playground();
    add("/users/*", "users-not-found");
    add("/users/:name/x/*", "users-by-name-x-not-found");
    expect(match("/users/jack/x/y/z")).toEqual({
      name: "users-by-name-x-not-found",
      params: {
        name: "jack",
        "*": "y/z",
      },
    });
  });

  it("should return a fresh params object on each match (no shared mutation)", ({
    expect,
  }) => {
    const { add, router } = playground();
    add("/users/:id", "user");

    const a = router.match("/users/42");
    const b = router.match("/users/42");
    expect(a.params).not.toBe(b.params);
    a.params!.injected = "x";
    expect(b.params).toEqual({ id: "42" });
  });

  it("should cache by pathname only (ignoring query string)", ({ expect }) => {
    const { add, router } = playground();
    add("/search", "search");

    router.match("/search?q=1");
    router.match("/search?q=2");
    router.match("/search?q=3");
    // cache is protected; assert via Map size on the subclass
    expect(
      (router as unknown as { cache: Map<string, unknown> }).cache.size,
    ).toBe(1);
  });

  it("should cap the cache size to avoid unbounded growth", ({ expect }) => {
    const { add, router } = playground();
    add("/*", "catchall");

    (router as unknown as { maxCacheSize: number }).maxCacheSize = 5;
    for (let i = 0; i < 20; i++) {
      router.match(`/x/${i}`);
    }
    const size = (router as unknown as { cache: Map<string, unknown> }).cache
      .size;
    expect(size).toBeLessThanOrEqual(5);
  });

  it("should invalidate the cache when a new route is pushed", ({ expect }) => {
    const { add, router } = playground();
    const m1 = router.match("/new");
    expect(m1.route).toBeUndefined();

    add("/new", "new-route");
    const m2 = router.match("/new");
    expect(m2.route?.name).toBe("new-route");
  });

  it("should handle three-way conflicting param names at the same level", ({
    expect,
  }) => {
    const { add, match } = playground();
    add("/u/:a", "a-route");
    add("/u/:b/x", "b-route");
    add("/u/:c/y", "c-route");

    expect(match("/u/1")).toEqual({ name: "a-route", params: { a: "1" } });
    expect(match("/u/1/x")).toEqual({ name: "b-route", params: { b: "1" } });
    expect(match("/u/1/y")).toEqual({ name: "c-route", params: { c: "1" } });
  });

  it("should handle routes with different param names", ({ expect }) => {
    const { add, match } = playground();
    add("/users/:id", "home");
    add("/users/:userId/hello", "hello");
    expect(match("/users/jack")).toEqual({
      name: "home",
      params: {
        id: "jack",
      },
    });
    expect(match("/users/jack/hello")).toEqual({
      name: "hello",
      params: {
        userId: "jack",
      },
    });
  });
});
