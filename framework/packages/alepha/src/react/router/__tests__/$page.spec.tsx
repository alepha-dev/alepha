import { Alepha, z } from "alepha";
import { $cache } from "alepha/cache";
import { OPTIONS } from "alepha/internal";
import type { FC } from "react";
import { beforeEach, describe, it } from "vitest";

import {
  $page,
  NestedView,
  PagePrimitive,
  Redirection,
  reactPageCacheOptions,
} from "../index.ts";

describe("$page primitive tests", () => {
  let alepha: Alepha;

  beforeEach(() => {
    alepha = Alepha.create();
  });

  it("$page - basic creation and configuration", async ({ expect }) => {
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

    const rendered = await app.basic.render();
    expect(rendered.html).toBe("Basic content");
  });

  it("$page - name defaults to property key", async ({ expect }) => {
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

  it("$page - schema validation with params and query", async ({ expect }) => {
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

    const rendered = await app.user.render({
      params: { id: "123" },
      query: { tab: "settings", sort: "name" },
    });
    expect(rendered.html).toBe("User 123 - Tab: settings");
  });

  it("$page - lazy component configuration", async ({ expect }) => {
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

    const rendered = await app.lazy.render();
    expect(rendered.html).toBe("Lazy: loaded");
  });

  it("$page - lazy takes precedence over component when both defined", async ({
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

    const rendered = await app.both.render();
    expect(rendered.html).toBe("Lazy Component");
  });

  it("$page - loader with async data loading", async ({ expect }) => {
    let loads = 0;

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
          return { data: `Data for ${params.id}`, loads: ++loads };
        },
        component: ({ data, loads }) => `${data}, load ${loads}`,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const rendered = await app.async.render({ params: { id: "test" } });
    expect(rendered.html).toBe("Data for test, load 1");
  });

  it("$page - parent-child relationship", async ({ expect }) => {
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

    const rendered = await app.child.render();
    expect(rendered.html).toBe("child with from parent");
  });

  it("$page - children as function", async ({ expect }) => {
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

    const parentRendered = await app.parent.render();
    expect(parentRendered.html).toBe("Parent content");

    const child1Rendered = await app.c1.render();
    expect(child1Rendered.html).toBe("Parent content<!-- -->Child 1");

    const child2Rendered = await app.c2.render();
    expect(child2Rendered.html).toBe("Parent content<!-- -->Child 2");
  });

  it("$page - error handler returns ReactNode", async ({ expect }) => {
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

    const rendered = await app.errorPage.render();
    expect(rendered.html).toBe("Error: Test error");
  });

  it("$page - error handler returns Redirection", async ({ expect }) => {
    class App {
      errorPage = $page({
        path: "/error",
        loader: () => {
          throw new Error("unauthorized");
        },
        errorHandler: (error) => {
          if (error.message === "unauthorized") {
            return new Redirection({ redirect: "/login" });
          }
          return undefined;
        },
        component: () => "Should not render",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const rendered = await app.errorPage.render();
    expect(rendered.redirect).toBe("/login");
  });

  it("$page - static page configuration", async ({ expect }) => {
    class App {
      staticPage = $page({
        path: "/static",
        static: true,
        component: () => "Static content",
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
        component: ({ id }) => `Static page ${id}`,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const staticRendered = await app.staticPage.render();
    expect(staticRendered.html).toBe("Static content");

    const staticWithEntriesRendered = await app.staticWithEntries.render({
      params: { id: "1" },
    });
    expect(staticWithEntriesRendered.html).toBe("Static page 1");
  });

  it("$page - static page adds no $cache, the page cache is automatic", async ({
    expect,
  }) => {
    class App {
      staticPage = $page({
        path: "/static",
        static: true,
        component: () => "Static content",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const cacheMw = app.staticPage.options.use?.find(
      (m) => m[OPTIONS]?.name === "$cache",
    );
    expect(cacheMw).toBeUndefined();

    const rendered = await app.staticPage.render();
    expect(rendered.html).toBe("Static content");
  });

  it("$page - a static page is served from the page cache", async ({
    expect,
  }) => {
    let renders = 0;

    class App {
      staticPage = $page({
        path: "/static",
        static: true,
        component: () => `Static ${++renders}`,
      });
    }

    // The markup counts its renders, which the anonymous re-render would
    // refuse (#E78): switched off to show the page cache itself keeps the
    // first copy.
    alepha.store.mut(reactPageCacheOptions, (it) => ({
      ...it,
      anonymousCheck: false,
    }));
    const app = alepha.inject(App);
    await alepha.start();

    const { html } = await app.staticPage.fetch();
    expect(html).toBe("Static 1");

    expect(await app.staticPage.fetch().then((it) => it.html)).toBe(html);
  });

  it("$page.fetch - fills the page's params and query into the URL", async ({
    expect,
  }) => {
    class App {
      user = $page({
        path: "/users/:id",
        schema: {
          params: z.object({ id: z.text() }),
          query: z.object({ tab: z.text() }),
        },
        loader: ({ params, query }) => ({
          label: `${params.id}/${query.tab}`,
        }),
        component: ({ label }) => label,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const { html, response } = await app.user.fetch({
      params: { id: "42" },
      query: { tab: "billing" },
    });

    expect(html).toBe("42/billing");
    expect(new URL(response.url).pathname).toBe("/users/42");
    expect(new URL(response.url).search).toBe("?tab=billing");
  });

  it("$page.fetch - builds a single slash, at the root and below it", async ({
    expect,
  }) => {
    class App {
      home = $page({ path: "/", component: () => "Home" });
      about = $page({ path: "/about", component: () => "About" });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const home = await app.home.fetch();
    const about = await app.about.fetch();

    expect(home.html).toBe("Home");
    expect(new URL(home.response.url).pathname).toBe("/");
    expect(about.html).toBe("About");
    expect(new URL(about.response.url).pathname).toBe("/about");
  });

  it("$page.fetch - requests a child under its parent's path", async ({
    expect,
  }) => {
    class App {
      settings = $page({
        path: "/settings",
        children: () => [this.profile],
        component: () => <NestedView />,
      });
      profile = $page({ path: "/profile", component: () => "Profile" });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const { html, response } = await app.profile.fetch();

    expect(html).toBe("Profile");
    expect(new URL(response.url).pathname).toBe("/settings/profile");
  });

  it("$page - onServerResponse sets the status of the HTTP response", async ({
    expect,
  }) => {
    class App {
      withHandler = $page({
        path: "/handler",
        onServerResponse: ({ reply }) => {
          reply.status = 202;
        },
        component: () => "With handler",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    const { html, response } = await app.withHandler.fetch();
    expect(response.status).toBe(202);
    expect(html).toBe("With handler");
  });

  it("$page - complex schema with nested objects", async ({ expect }) => {
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

  it("$page - a JSON query value is not percent-decoded twice", async ({
    expect,
  }) => {
    class App {
      search = $page({
        path: "/search",
        schema: { query: z.object({ filter: z.object({ q: z.text() }) }) },
        loader: ({ query }) => ({ q: query.filter.q }),
        component: (props: { q: string }) => `q=${props.q}`,
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    // A lone `%` is not an escape: decoding it again threw, and the page
    // rendered its error view for a valid URL.
    expect(
      (await app.search.render({ query: { filter: '{"q":"50%"}' } })).html,
    ).toBe("q=50%");
    // A literal `%41` stays what the visitor typed.
    expect(
      (await app.search.render({ query: { filter: '{"q":"%41"}' } })).html,
    ).toBe("q=%41");
    // Over HTTP, where the server decoded the query once already.
    const { html } = await app.search.fetch({
      query: { filter: '{"q":"50%"}' },
    });
    expect(html).toBe("q=50%");
  });

  it("$page - fetch() returns the whole root content, nested divs included", async ({
    expect,
  }) => {
    class App {
      home = $page({
        path: "/",
        component: () => (
          <div>
            <div>a</div>
            <p>b</p>
          </div>
        ),
      });
      card = $page({
        path: "/card",
        loader: () => ({ title: "t" }),
        component: (props: { title: string }) => (
          <section>
            <div>{props.title}</div>
          </section>
        ),
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    expect((await app.home.fetch()).html).toBe(
      '<div vt-update="none"><div>a</div><p>b</p></div>',
    );
    // Stops at the root's own closing tag: no hydration script.
    expect((await app.card.fetch()).html).toBe(
      '<section vt-update="none"><div>t</div></section>',
    );
  });

  it("$page - error handlers in a hierarchy", async ({ expect }) => {
    const calls: string[] = [];

    class App {
      parent = $page({
        path: "/parent",
        errorHandler: (error) => {
          calls.push(`parent:${error.message}`);
          return error.message === "nobody"
            ? undefined
            : `Parent handled: ${error.message}`;
        },
      });

      middle = $page({
        path: "/middle",
        parent: this.parent,
      });

      child = $page({
        path: "/child",
        parent: this.middle,
        schema: { query: z.object({ fail: z.text().default("child") }) },
        loader: ({ query }) => {
          throw new Error(query.fail);
        },
        errorHandler: (error) => {
          calls.push(`child:${error.message}`);
          return error.message === "child"
            ? `Child handled: ${error.message}`
            : undefined;
        },
        component: () => "Child",
      });

      inherits = $page({
        path: "/inherits",
        parent: this.middle,
        schema: { query: z.object({ fail: z.text().default("inherited") }) },
        loader: ({ query }) => {
          throw new Error(query.fail);
        },
        component: () => "Inherits",
      });
    }

    const app = alepha.inject(App);
    await alepha.start();

    // The nearest handler answers.
    expect((await app.child.render()).html).toBe("Child handled: child");
    expect(calls).toEqual(["child:child"]);

    // It passes (`undefined`): the parent's answers, once.
    calls.length = 0;
    expect((await app.child.render({ query: { fail: "other" } })).html).toBe(
      "Parent handled: other",
    );
    expect(calls).toEqual(["child:other", "parent:other"]);

    // A handler inherited through two layers runs once per error, not once
    // per layer below it.
    calls.length = 0;
    expect((await app.inherits.render()).html).toBe(
      "Parent handled: inherited",
    );
    expect(calls).toEqual(["parent:inherited"]);

    // Even when it passes, leaving the built-in error view to render.
    calls.length = 0;
    await app.inherits.render({ query: { fail: "nobody" } });
    expect(calls).toEqual(["parent:nobody"]);
  });

  it("$page - loader receives parent props", async ({ expect }) => {
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

    const rendered = await app.child.fetch();
    expect(rendered.html).toBe("Child received: from parent and from parent");
  });

  it("$page - redirect shorthand", async ({ expect }) => {
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

  it("$page - a raw $cache in use is refused", async ({ expect }) => {
    // It stored the whole document, the visitor's private state included.
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

    expect(() => alepha.inject(App)).toThrow(/uses \$cache in `use`/);
  });
});
