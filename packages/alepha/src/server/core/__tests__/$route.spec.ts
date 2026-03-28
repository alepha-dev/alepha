import { Alepha, createMiddleware, t } from "alepha";
import { describe, test } from "vitest";
import { $route, ServerProvider } from "../index.ts";

describe("$route", () => {
  test("should return the correct route", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestApp {
      $route = $route({
        path: "/hello",
        handler: () => "OK",
      });
    }

    await alepha.with(TestApp).start();

    const resp = await fetch(`${alepha.inject(ServerProvider).hostname}/hello`);
    expect(await resp.text()).toBe("OK");
  });

  test("should return the correct route with queryParams", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class TestApp {
      $route = $route({
        path: "/hello",
        schema: {
          query: t.object({
            a: t.optional(t.text()),
            b: t.optional(t.array(t.text())),
            c: t.optional(
              t.object({
                d: t.text(),
              }),
            ),
          }),
        },
        handler: ({ query }) => JSON.stringify({ query }),
      });
    }

    await alepha.with(TestApp).start();

    const resp = await fetch(
      `${alepha.inject(ServerProvider).hostname}/hello?a=1&b=["HELLO","WORLD"]&c=${encodeURIComponent(
        JSON.stringify({
          d: "e",
        }),
      )}`,
    );

    expect(await resp.json()).toEqual({
      query: {
        a: "1",
        b: ["HELLO", "WORLD"],
        c: {
          d: "e",
        },
      },
    });
  });

  test("should apply per-route middleware via use option", async ({
    expect,
  }) => {
    const log: string[] = [];
    const $track = () =>
      createMiddleware({
        name: "$track",
        handler:
          ({ next }) =>
          async (...args: any[]) => {
            log.push("before");
            const result = await next(...args);
            log.push("after");
            return result;
          },
      });

    const alepha = Alepha.create();

    class TestApp {
      route = $route({
        path: "/hello",
        use: [$track()],
        handler: () => {
          log.push("handler");
          return "OK";
        },
      });
    }

    await alepha.with(TestApp).start();

    const resp = await fetch(`${alepha.inject(ServerProvider).hostname}/hello`);
    expect(await resp.text()).toBe("OK");
    expect(log).toStrictEqual(["before", "handler", "after"]);
  });
});
