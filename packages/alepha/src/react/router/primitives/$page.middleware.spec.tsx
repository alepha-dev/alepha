import { Alepha, createMiddleware, type Middleware } from "alepha";
import { describe, test } from "vitest";
import { $page, PagePrimitive } from "../index.ts";

describe("$page middleware", () => {
  test("applies middleware to server handler (wraps loader + render)", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    const calls: string[] = [];

    const $track = (): Middleware =>
      createMiddleware({
        name: "$track",
        handler:
          ({ next }) =>
          async (...args: any[]) => {
            calls.push("before");
            const result = await next(...args);
            calls.push("after");
            return result;
          },
      });

    class App {
      page = $page({
        path: "/test",
        use: [$track()],
        loader: () => {
          calls.push("loader");
          return { message: "hello" };
        },
        component: ({ message }: { message: string }) => `Result: ${message}`,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const result = await app.page.render();
    expect(result.html).toBe("Result: hello");
    // Middleware wraps the full server handler, so before/after surround loader+render
    expect(calls).toEqual(["before", "loader", "after"]);
  });

  test("works without middleware", async ({ expect }) => {
    const alepha = Alepha.create();

    class App {
      page = $page({
        path: "/no-mw",
        loader: () => ({ value: "ok" }),
        component: ({ value }: { value: string }) => value,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const result = await app.page.render();
    expect(result.html).toBe("ok");
  });

  test("works with empty use array", async ({ expect }) => {
    const alepha = Alepha.create();

    class App {
      page = $page({
        path: "/empty-use",
        use: [],
        loader: () => ({ value: "ok" }),
        component: ({ value }: { value: string }) => value,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const result = await app.page.render();
    expect(result.html).toBe("ok");
  });

  test("parent middleware cascades to child pages", async ({ expect }) => {
    const alepha = Alepha.create();

    const calls: string[] = [];

    const $parentGuard = (): Middleware =>
      createMiddleware({
        name: "$parentGuard",
        handler:
          ({ next }) =>
          async (...args: any[]) => {
            calls.push("parent");
            return next(...args);
          },
      });

    const $childGuard = (): Middleware =>
      createMiddleware({
        name: "$childGuard",
        handler:
          ({ next }) =>
          async (...args: any[]) => {
            calls.push("child");
            return next(...args);
          },
      });

    class App {
      layout = $page({
        use: [$parentGuard()],
        children: () => [this.child],
        component: () => "layout",
      });

      child = $page({
        path: "/child",
        use: [$childGuard()],
        loader: () => {
          calls.push("loader");
          return { msg: "hello" };
        },
        component: ({ msg }: { msg: string }) => msg,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const result = await app.child.fetch({ html: true });
    expect(result.html).toContain("hello");

    // Parent middleware should run before child middleware
    expect(calls).toEqual(["parent", "child", "loader"]);
  });

  test("is still a PagePrimitive", ({ expect }) => {
    const alepha = Alepha.create();

    const $noop = (): Middleware =>
      createMiddleware({
        name: "$noop",
        handler: ({ next }) => next,
      });

    class App {
      page = $page({
        path: "/instance",
        use: [$noop()],
        loader: () => ({ value: 1 }),
        component: () => "ok",
      });
    }

    const app = alepha.inject(App);
    expect(app.page).toBeInstanceOf(PagePrimitive);
    expect(app.page.options.use).toHaveLength(1);
  });
});
