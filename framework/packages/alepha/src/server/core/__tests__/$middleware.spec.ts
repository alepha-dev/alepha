import { Alepha, createMiddleware, z } from "alepha";
import { describe, it } from "vitest";

import { $action, $middleware, $route, ServerProvider } from "../index.ts";

const $track = (log: string[], tag: string) =>
  createMiddleware({
    name: `$track:${tag}`,
    handler:
      ({ next }) =>
      async (...args: any[]) => {
        log.push(`${tag}:before`);
        const result = await next(...args);
        log.push(`${tag}:after`);
        return result;
      },
  });

describe("$middleware", () => {
  it("should apply middleware to matching routes", async ({ expect }) => {
    const log: string[] = [];

    class TestApp {
      mid = $middleware({
        path: "/api",
        use: [$track(log, "global")],
      });

      hello = $action({
        path: "/hello",
        method: "GET",
        schema: { response: z.object({ message: z.text() }) },
        handler: () => {
          log.push("handler");
          return { message: "hello" };
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(TestApp);
    await alepha.start();

    const res = await app.hello.fetch({}).then((it) => it.data);
    expect(res).toStrictEqual({ message: "hello" });
    expect(log).toStrictEqual(["global:before", "handler", "global:after"]);
  });

  it("should not apply middleware to non-matching routes", async ({
    expect,
  }) => {
    const log: string[] = [];

    class TestApp {
      mid = $middleware({
        path: "/admin",
        use: [$track(log, "admin")],
      });

      hello = $action({
        path: "/hello",
        method: "GET",
        schema: { response: z.text() },
        handler: () => {
          log.push("handler");
          return "ok";
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(TestApp);
    await alepha.start();

    await app.hello.fetch({});
    expect(log).toStrictEqual(["handler"]);
  });

  it("should apply to routes registered before the middleware", async ({
    expect,
  }) => {
    const log: string[] = [];

    class TestApp {
      route = $route({
        path: "/late/hello",
        handler: () => {
          log.push("handler");
          return "ok";
        },
      });

      mid = $middleware({
        path: "/late",
        use: [$track(log, "late")],
      });
    }

    const alepha = Alepha.create();
    alepha.inject(TestApp);
    await alepha.start();

    const resp = await fetch(
      `${alepha.inject(ServerProvider).hostname}/late/hello`,
    );
    expect(await resp.text()).toBe("ok");
    expect(log).toStrictEqual(["late:before", "handler", "late:after"]);
  });

  it("should cover a route at exactly the prefix, declared before or after", async ({
    expect,
  }) => {
    const log: string[] = [];

    class TestApp {
      before = $route({
        path: "/early",
        handler: () => "early",
      });

      early = $middleware({
        path: "/early",
        use: [$track(log, "early")],
      });

      admin = $middleware({
        path: "/admin",
        use: [$track(log, "admin")],
      });

      root = $route({
        path: "/admin",
        handler: () => "root",
      });

      child = $route({
        path: "/admin/users",
        handler: () => "child",
      });

      sibling = $route({
        path: "/administrator",
        handler: () => "sibling",
      });
    }

    const alepha = Alepha.create();
    alepha.inject(TestApp);
    await alepha.start();
    const hostname = alepha.inject(ServerProvider).hostname;
    const get = async (path: string) => {
      log.length = 0;
      const text = await fetch(`${hostname}${path}`).then((it) => it.text());
      return [text, ...log];
    };

    expect(await get("/admin")).toStrictEqual([
      "root",
      "admin:before",
      "admin:after",
    ]);
    expect(await get("/admin/")).toStrictEqual([
      "root",
      "admin:before",
      "admin:after",
    ]);
    expect(await get("/admin/users")).toStrictEqual([
      "child",
      "admin:before",
      "admin:after",
    ]);
    expect(await get("/early")).toStrictEqual([
      "early",
      "early:before",
      "early:after",
    ]);
    // A longer first segment is another path, not something under `/admin`.
    expect(await get("/administrator")).toStrictEqual(["sibling"]);
  });

  describe("a route declared in another spelling than the prefix", () => {
    // The router serves a declared path after normalizing it (case, doubled
    // or missing slashes, param names): the middleware has to cover what the
    // router serves, not what the two strings look like.
    const served = async (
      prefix: string,
      routePath: string,
      requestPath: string,
      exclude?: string[],
    ) => {
      const log: string[] = [];

      class TestApp {
        mid = $middleware({ path: prefix, use: [$track(log, "mid")], exclude });
        route = $route({ path: routePath, handler: () => "ok" });
      }

      const alepha = Alepha.create();
      alepha.inject(TestApp);
      await alepha.start();
      const resp = await fetch(
        `${alepha.inject(ServerProvider).hostname}${requestPath}`,
      );
      return [await resp.text(), ...log];
    };

    const covered = ["ok", "mid:before", "mid:after"];

    it("should cover a route declared in another case", async ({ expect }) => {
      expect(await served("/case", "/Case/Secret", "/case/secret")).toEqual(
        covered,
      );
      expect(await served("/CASE", "/case", "/case")).toEqual(covered);
    });

    it("should cover a route declared with no leading slash", async ({
      expect,
    }) => {
      expect(await served("/nolead", "nolead/x", "/nolead/x")).toEqual(covered);
    });

    it("should cover a route declared with a doubled slash", async ({
      expect,
    }) => {
      expect(await served("/admin", "//admin/dbl", "/admin/dbl")).toEqual(
        covered,
      );
      expect(await served("//admin/", "/admin/dbl", "/admin/dbl")).toEqual(
        covered,
      );
    });

    it("should read a path that already ends in a wildcard as its prefix", async ({
      expect,
    }) => {
      expect(await served("/star/*", "/star/x", "/star/x")).toEqual(covered);
      expect(await served("/star/*", "/star", "/star")).toEqual(covered);
    });

    it("should match a param segment by position, whatever its name", async ({
      expect,
    }) => {
      expect(await served("/org/:id", "/org/:orgId/y", "/org/1/y")).toEqual(
        covered,
      );
      expect(await served("/org/{id}", "/org/:orgId", "/org/1")).toEqual(
        covered,
      );
      // A static segment is not a param: another path.
      expect(await served("/org/:id/a", "/org/:orgId/b", "/org/1/b")).toEqual([
        "ok",
      ]);
    });

    it("should exclude in the same spelling-blind way", async ({ expect }) => {
      expect(
        await served("/admin", "/Admin/Open/x", "/admin/open/x", [
          "/admin/open",
        ]),
      ).toEqual(["ok"]);
    });

    it("should cover every route for the root prefix", async ({ expect }) => {
      expect(await served("/", "/anything/at/all", "/anything/at/all")).toEqual(
        covered,
      );
    });
  });

  it("should exclude the exact path and what is under it", async ({
    expect,
  }) => {
    const log: string[] = [];

    class TestApp {
      mid = $middleware({
        path: "/admin",
        use: [$track(log, "admin")],
        exclude: ["/admin"],
      });

      root = $route({ path: "/admin", handler: () => "root" });
    }

    const alepha = Alepha.create();
    alepha.inject(TestApp);
    await alepha.start();

    const resp = await fetch(`${alepha.inject(ServerProvider).hostname}/admin`);
    expect(await resp.text()).toBe("root");
    expect(log).toStrictEqual([]);
  });

  it("should filter by method", async ({ expect }) => {
    const log: string[] = [];

    class TestApp {
      mid = $middleware({
        path: "/api",
        use: [$track(log, "post-only")],
        method: "POST",
      });

      getAction = $action({
        path: "/getAction",
        method: "GET",
        schema: { response: z.text() },
        handler: () => {
          log.push("get");
          return "ok";
        },
      });

      postAction = $action({
        path: "/postAction",
        method: "POST",
        schema: {
          body: z.object({ value: z.text() }),
          response: z.text(),
        },
        handler: () => {
          log.push("post");
          return "ok";
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(TestApp);
    await alepha.start();

    await app.getAction.fetch({});
    expect(log).toStrictEqual(["get"]);

    log.length = 0;
    await app.postAction.fetch({ body: { value: "test" } });
    expect(log).toStrictEqual(["post-only:before", "post", "post-only:after"]);
  });

  it("should exclude specific paths", async ({ expect }) => {
    const log: string[] = [];

    class TestApp {
      mid = $middleware({
        path: "/api",
        use: [$track(log, "global")],
        exclude: ["/api/health"],
      });

      health = $action({
        method: "GET",
        path: "/health",
        schema: { response: z.text() },
        handler: () => {
          log.push("health");
          return "ok";
        },
      });

      hello = $action({
        path: "/hello",
        method: "GET",
        schema: { response: z.text() },
        handler: () => {
          log.push("hello");
          return "ok";
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(TestApp);
    await alepha.start();

    await app.health.fetch({});
    expect(log).toStrictEqual(["health"]);

    log.length = 0;
    await app.hello.fetch({});
    expect(log).toStrictEqual(["global:before", "hello", "global:after"]);
  });

  it("should compose with per-route middleware", async ({ expect }) => {
    const log: string[] = [];

    class TestApp {
      mid = $middleware({
        path: "/api",
        use: [$track(log, "global")],
      });

      hello = $action({
        path: "/hello",
        method: "GET",
        use: [$track(log, "local")],
        schema: { response: z.text() },
        handler: () => {
          log.push("handler");
          return "ok";
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(TestApp);
    await alepha.start();

    await app.hello.fetch({});
    expect(log).toStrictEqual([
      "global:before",
      "local:before",
      "handler",
      "local:after",
      "global:after",
    ]);
  });

  it("should work with $route primitive", async ({ expect }) => {
    const log: string[] = [];

    class TestApp {
      mid = $middleware({
        path: "/test",
        use: [$track(log, "global")],
      });

      route = $route({
        path: "/test/hello",
        handler: () => {
          log.push("handler");
          return "ok";
        },
      });
    }

    const alepha = Alepha.create();
    alepha.inject(TestApp);
    await alepha.start();

    const resp = await fetch(
      `${alepha.inject(ServerProvider).hostname}/test/hello`,
    );
    expect(await resp.text()).toBe("ok");
    expect(log).toStrictEqual(["global:before", "handler", "global:after"]);
  });
});
