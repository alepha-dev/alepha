import { Alepha, OPTIONS, z } from "alepha";
import { $cache } from "alepha/cache";
import type { FC } from "react";
import { beforeEach, describe, test, vi } from "vitest";

import {
  $page,
  NestedView,
  PagePrimitive,
  type ReactRouterState,
  Redirection,
} from "../index.ts";

describe("$page primitive tests", () => {
  let alepha: Alepha;

  beforeEach(() => {
    alepha = Alepha.create();
  });

  test("$page - basic creation and configuration", async ({ expect }) => {
    class App {
      basic = $page({
        name: "Basic Page",
        path: "/basic",
        component: () => "Basic content",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    expect(app.basic).toBeInstanceOf(PagePrimitive);
    expect(app.basic.name).toBe("Basic Page");
    expect(app.basic.options.path).toBe("/basic");

    const rendered = await app.basic.render();
    expect(rendered.html).toBe("Basic content");
  });

  test("$page - name defaults to property key", async ({ expect }) => {
    class App {
      testPageName = $page({
        component: () => "test content",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    expect(app.testPageName.name).toBe("testPageName");

    const rendered = await app.testPageName.render();
    expect(rendered.html).toBe("test content");
  });

  test("$page - schema validation with params and query", async ({
    expect,
  }) => {
    class App {
      user = $page({
        path: "/user/:id",
        schema: {
          params: z.object({
            id: z.text(),
          }),
          query: z.object({
            tab: z.text({ default: "profile" }),
            sort: z.text().optional(),
          }),
        },
        loader: ({ params, query }) => ({ params, query }),
        component: ({ params, query }) =>
          `User ${params.id} - Tab: ${query.tab}`,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    expect(app.user.options.schema?.params).toBeDefined();
    expect(app.user.options.schema?.query).toBeDefined();
    expect(app.user.options.loader).toBeDefined();
    expect(app.user.options.component).toBeDefined();

    const rendered = await app.user.render({
      params: { id: "123" },
      query: { tab: "settings", sort: "name" },
    });
    expect(rendered.html).toBe("User 123 - Tab: settings");
  });

  test("$page - lazy component configuration", async ({ expect }) => {
    const LazyComponent: FC<{ message: string }> = ({ message }) =>
      `Lazy: ${message}`;

    class App {
      lazy = $page({
        path: "/lazy",
        loader: () => ({ message: "loaded" }),
        lazy: async () => ({ default: LazyComponent }),
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    expect(app.lazy.options.lazy).toBeDefined();
    expect(typeof app.lazy.options.lazy).toBe("function");

    const lazyModule = await app.lazy.options.lazy!();
    expect(lazyModule.default).toBe(LazyComponent);

    const rendered = await app.lazy.render();
    expect(rendered.html).toBe("Lazy: loaded");
  });

  test("$page - lazy takes precedence over component when both defined", async ({
    expect,
  }) => {
    const Component: FC = () => "Component";
    const LazyComponent: FC = () => "Lazy Component";

    class App {
      both = $page({
        component: Component,
        lazy: async () => ({ default: LazyComponent }),
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    expect(app.both.options.component).toBe(Component);
    expect(app.both.options.lazy).toBeDefined();

    const rendered = await app.both.render();
    expect(rendered.html).toBe("Lazy Component");
  });

  test("$page - resolve function with async data loading", async ({
    expect,
  }) => {
    class App {
      async = $page({
        path: "/async/:id",
        schema: {
          params: z.object({
            id: z.text(),
          }),
        },
        loader: async ({ params }) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { data: `Data for ${params.id}`, timestamp: Date.now() };
        },
        component: ({ data, timestamp }) => `${data} at ${timestamp}`,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    expect(app.async.options.loader).toBeDefined();
    expect(typeof app.async.options.loader).toBe("function");

    const mockContext = {
      params: { id: "test" },
      query: {},
      pathname: "/async/test",
      search: "",
    };
    const result = await app.async.options.loader!(mockContext as any);
    expect(result.data).toBe("Data for test");
    expect(typeof result.timestamp).toBe("number");

    const rendered = await app.async.render({ params: { id: "test" } });
    expect(rendered.html).toMatch(/^Data for test at \d+$/);
  });

  test("$page - parent-child relationship", async ({ expect }) => {
    class App {
      parent = $page({
        path: "/parent",
        loader: () => ({ parentData: "from parent" }),
        children: [],
      });

      child = $page({
        path: "/child",
        parent: this.parent,
        loader: ({ parentData }) => ({
          childData: `child with ${parentData}`,
        }),
        component: ({ childData }) => childData,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    expect(app.child.options.parent).toBe(app.parent);

    const rendered = await app.child.render();
    expect(rendered.html).toBe("child with from parent");
  });

  test("$page - children as function", async ({ expect }) => {
    class App {
      c1 = $page({ path: "/child1", component: () => "Child 1" });
      c2 = $page({ path: "/child2", component: () => "Child 2" });
      parent = $page({
        path: "/parent",
        children: () => [this.c1, this.c2],
        component: () => (
          <>
            Parent content
            <NestedView />
          </>
        ),
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const children =
      typeof app.parent.options.children === "function"
        ? app.parent.options.children()
        : app.parent.options.children;

    expect(children).toHaveLength(2);
    expect(children?.[0].options.path).toBe("/child1");
    expect(children?.[1].options.path).toBe("/child2");

    const parentRendered = await app.parent.render();
    expect(parentRendered.html).toBe("Parent content");

    const child1Rendered = await app.c1.render();
    expect(child1Rendered.html).toBe("Parent content<!-- -->Child 1");

    const child2Rendered = await app.c2.render();
    expect(child2Rendered.html).toBe("Parent content<!-- -->Child 2");
  });

  test("$page - can permission function", async ({ expect }) => {
    let canAccess = true;

    class App {
      protected = $page({
        path: "/protected",
        can: () => canAccess,
        component: () => "Protected content",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const ctx = { has: () => false };
    expect(app.protected.options.can?.(ctx)).toBe(true);

    canAccess = false;
    expect(app.protected.options.can?.(ctx)).toBe(false);

    const rendered = await app.protected.render();
    expect(rendered.html).toBe("Protected content");
  });

  test("$page - error handler returns ReactNode", async ({ expect }) => {
    class App {
      errorPage = $page({
        path: "/error",
        loader: () => {
          throw new Error("Test error");
        },
        errorHandler: (error) => `Error: ${error.message}`,
        component: () => "Should not render",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    expect(app.errorPage.options.errorHandler).toBeDefined();

    const mockState = {} as ReactRouterState;
    const result = app.errorPage.options.errorHandler?.(
      new Error("Test error"),
      mockState,
    );
    expect(result).toBe("Error: Test error");

    const rendered = await app.errorPage.render();
    expect(rendered.html).toBe("Error: Test error");
  });

  test("$page - error handler returns Redirection", async ({ expect }) => {
    class App {
      errorPage = $page({
        path: "/error",
        loader: () => {
          throw new Error("unauthorized");
        },
        errorHandler: (error) => {
          if (error.message === "unauthorized") {
            return new Redirection("/login");
          }
          return undefined;
        },
        component: () => "Should not render",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const mockState = {} as ReactRouterState;

    const redirect = app.errorPage.options.errorHandler?.(
      new Error("unauthorized"),
      mockState,
    );
    expect(redirect).toBeInstanceOf(Redirection);
    expect((redirect as Redirection).redirect).toBe("/login");

    const noRedirect = app.errorPage.options.errorHandler?.(
      new Error("other"),
      mockState,
    );
    expect(noRedirect).toBeUndefined();

    const rendered = await app.errorPage.render();
    expect(rendered.redirect).toBe("/login");
  });

  test("$page - static page configuration", async ({ expect }) => {
    class App {
      staticPage = $page({
        path: "/static",
        static: true,
        component: () => "Infer content",
      });

      staticWithEntries = $page({
        path: "/static/:id",
        schema: {
          params: z.object({
            id: z.text(),
          }),
        },
        static: {
          entries: [{ params: { id: "1" } }, { params: { id: "2" } }],
        },
        loader: ({ params }) => ({ id: params.id }),
        component: ({ id }) => `Infer page ${id}`,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    expect(app.staticPage.options.static).toBe(true);
    expect(app.staticWithEntries.options.static).toEqual({
      entries: [{ params: { id: "1" } }, { params: { id: "2" } }],
    });

    const staticRendered = await app.staticPage.render();
    expect(staticRendered.html).toBe("Infer content");

    const staticWithEntriesRendered = await app.staticWithEntries.render({
      params: { id: "1" },
    });
    expect(staticWithEntriesRendered.html).toBe("Infer page 1");
  });

  test("$page - static page sets default cache configuration", async ({
    expect,
  }) => {
    class App {
      staticPage = $page({
        path: "/static",
        static: true,
        component: () => "Infer content",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const cacheMw = app.staticPage.options.use?.find(
      (m) => m[OPTIONS]?.name === "$cache",
    );
    expect(cacheMw).toBeDefined();
    expect(cacheMw?.[OPTIONS]?.options).toEqual({
      name: "page:staticPage",
      provider: "memory",
      ttl: [1, "week"],
    });

    const rendered = await app.staticPage.render();
    expect(rendered.html).toBe("Infer content");
  });

  test("$page - static page respects custom cache configuration", async ({
    expect,
  }) => {
    class App {
      staticPage = $page({
        path: "/static",
        static: true,
        component: () => `Infer ${Date.now()}`,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const { html } = await app.staticPage.fetch();
    expect(html).toMatch(/^Infer \d+$/);

    expect(await app.staticPage.fetch().then((it) => it.html)).toBe(html);
  });

  test("$page - server response handler", async ({ expect }) => {
    const mockHandler = vi.fn();

    class App {
      withHandler = $page({
        path: "/handler",
        onServerResponse: mockHandler,
        component: () => "With handler",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    expect(app.withHandler.options.onServerResponse).toBe(mockHandler);

    const rendered = await app.withHandler.render();
    expect(rendered.html).toBe("With handler");
  });

  test("$page - onLeave handler", async ({ expect }) => {
    const mockLeaveHandler = vi.fn();

    class App {
      leavePage = $page({
        path: "/leave",
        onLeave: mockLeaveHandler,
        component: () => "Leave page",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    expect(app.leavePage.options.onLeave).toBe(mockLeaveHandler);

    const rendered = await app.leavePage.render();
    expect(rendered.html).toBe("Leave page");
  });

  test("$page - animation configuration", async ({ expect }) => {
    class App {
      simpleAnimation = $page({
        path: "/simple-anim",
        animation: "fadeIn",
        component: () => "Simple animation",
      });

      detailedAnimation = $page({
        path: "/detailed-anim",
        animation: {
          enter: { name: "fadeIn", duration: 300, timing: "ease-in" },
          exit: { name: "fadeOut", duration: 200, timing: "ease-out" },
        },
        component: () => "Detailed animation",
      });

      functionAnimation = $page({
        path: "/function-anim",
        animation: (state) => ({ enter: "slideIn", exit: "slideOut" }),
        component: () => "Function animation",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    expect(app.simpleAnimation.options.animation).toBe("fadeIn");
    expect(app.detailedAnimation.options.animation).toEqual({
      enter: { name: "fadeIn", duration: 300, timing: "ease-in" },
      exit: { name: "fadeOut", duration: 200, timing: "ease-out" },
    });

    const mockState = {} as ReactRouterState;
    const dynamicAnimation =
      typeof app.functionAnimation.options.animation === "function"
        ? app.functionAnimation.options.animation(mockState)
        : app.functionAnimation.options.animation;
    expect(dynamicAnimation).toEqual({ enter: "slideIn", exit: "slideOut" });

    const simpleRendered = await app.simpleAnimation.render();
    expect(simpleRendered.html).toBe("Simple animation");

    const detailedRendered = await app.detailedAnimation.render();
    expect(detailedRendered.html).toBe("Detailed animation");

    const functionRendered = await app.functionAnimation.render();
    expect(functionRendered.html).toBe("Function animation");
  });

  test("$page - complex schema with nested objects", async ({ expect }) => {
    class App {
      complex = $page({
        path: "/complex/:userId",
        schema: {
          params: z.object({
            userId: z.text(),
          }),
          query: z.object({
            filters: z
              .object({
                status: z.text({ default: "active" }),
                category: z.text().optional(),
              })
              .optional(),
            page: z.number().default(1),
            limit: z.number().default(10),
          }),
        },
        loader: ({ params, query }) => ({
          user: { id: params.userId },
          pagination: { page: query.page, limit: query.limit },
          filters: query.filters,
        }),
        component: ({ user, pagination, filters }) => {
          return `User ${user.id}, Page ${pagination.page}/${pagination.limit}, Filters: ${JSON.stringify(filters).replaceAll('"', " ")}`;
        },
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    expect(app.complex.options.schema?.params).toBeDefined();
    expect(app.complex.options.schema?.query).toBeDefined();
    expect(app.complex.options.loader).toBeDefined();

    const rendered = await app.complex.render({
      params: { userId: "123" },
      query: {
        page: "2",
        limit: "20",
        filters: JSON.stringify({ status: "inactive", category: "premium" }),
      },
    });
    expect(rendered.html).toBe(
      "User 123, Page 2/20, Filters: { status : inactive , category : premium }",
    );
  });

  test("$page - multiple error handlers in hierarchy", async ({ expect }) => {
    class App {
      parent = $page({
        path: "/parent",
        errorHandler: (error) => `Parent handled: ${error.message}`,
        children: [],
        component: () => "Parent content",
      });

      child = $page({
        path: "/child",
        loader: () => {
          throw new Error("Child error");
        },
        errorHandler: (error) => {
          if (error.message === "Child error") {
            return `Child handled: ${error.message}`;
          }
          return undefined;
        },
        component: () => "Child",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const mockState = {} as ReactRouterState;

    const childResult = app.child.options.errorHandler?.(
      new Error("Child error"),
      mockState,
    );
    expect(childResult).toBe("Child handled: Child error");

    const parentResult = app.parent.options.errorHandler?.(
      new Error("Other error"),
      mockState,
    );
    expect(parentResult).toBe("Parent handled: Other error");

    const childRendered = await app.child.render();
    expect(childRendered.html).toBe("Child handled: Child error");

    const parentRendered = await app.parent.render();
    expect(parentRendered.html).toBe("Parent content");
  });

  test("$page - resolve function receives parent props", async ({ expect }) => {
    class App {
      parent = $page({
        loader: () => ({ parentValue: "from parent" }),
      });

      child = $page({
        path: "/child",
        parent: this.parent,
        loader: ({ parentValue }) => ({
          childData: `Child received: ${parentValue}`,
        }),
        component: ({ childData, parentValue }) =>
          `${childData} and ${parentValue}`,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    expect(app.child.options.loader).toBeDefined();

    const rendered = await app.child.fetch();
    expect(rendered.html).toBe("Child received: from parent and from parent");
  });

  test("$page - redirect shorthand", async ({ expect }) => {
    class App {
      home = $page({
        path: "/",
        redirect: "/dashboard",
      });

      dashboard = $page({
        path: "/dashboard",
        component: () => "Dashboard",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const rendered = await app.home.render();
    expect(rendered.redirect).toBe("/dashboard");
  });

  test("$page - cache configuration without static", async ({ expect }) => {
    class App {
      cached = $page({
        path: "/cached",
        use: [
          $cache({
            provider: "memory",
            ttl: [5, "minute"],
          }),
        ],
        component: () => "Cached content",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const cacheMw = app.cached.options.use?.find(
      (m) => m[OPTIONS]?.name === "$cache",
    );
    expect(cacheMw).toBeDefined();
    expect(app.cached.options.static).toBeUndefined();

    const rendered = await app.cached.render();
    expect(rendered.html).toBe("Cached content");
  });
});
