import { Alepha, createMiddleware, t } from "alepha";
import { describe, test } from "vitest";
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
  test("should apply middleware to matching routes", async ({ expect }) => {
    const log: string[] = [];

    class TestApp {
      mid = $middleware({
        path: "/api",
        use: [$track(log, "global")],
      });

      hello = $action({
        schema: { response: t.object({ message: t.text() }) },
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

  test("should not apply middleware to non-matching routes", async ({
    expect,
  }) => {
    const log: string[] = [];

    class TestApp {
      mid = $middleware({
        path: "/admin",
        use: [$track(log, "admin")],
      });

      hello = $action({
        schema: { response: t.text() },
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

  test("should apply to routes registered after middleware", async ({
    expect,
  }) => {
    const log: string[] = [];

    class TestApp {
      mid = $middleware({
        path: "/api",
        use: [$track(log, "first")],
      });

      hello = $action({
        schema: { response: t.text() },
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
    expect(log).toStrictEqual(["first:before", "handler", "first:after"]);
  });

  test("should filter by method", async ({ expect }) => {
    const log: string[] = [];

    class TestApp {
      mid = $middleware({
        path: "/api",
        use: [$track(log, "post-only")],
        method: "POST",
      });

      getAction = $action({
        schema: { response: t.text() },
        handler: () => {
          log.push("get");
          return "ok";
        },
      });

      postAction = $action({
        method: "POST",
        schema: {
          body: t.object({ value: t.text() }),
          response: t.text(),
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

  test("should exclude specific paths", async ({ expect }) => {
    const log: string[] = [];

    class TestApp {
      mid = $middleware({
        path: "/api",
        use: [$track(log, "global")],
        exclude: ["/api/health"],
      });

      health = $action({
        path: "/health",
        schema: { response: t.text() },
        handler: () => {
          log.push("health");
          return "ok";
        },
      });

      hello = $action({
        schema: { response: t.text() },
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

  test("should compose with per-route middleware", async ({ expect }) => {
    const log: string[] = [];

    class TestApp {
      mid = $middleware({
        path: "/api",
        use: [$track(log, "global")],
      });

      hello = $action({
        use: [$track(log, "local")],
        schema: { response: t.text() },
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

  test("should work with $route primitive", async ({ expect }) => {
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
