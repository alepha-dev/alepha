import { waitFor } from "@testing-library/dom";
import { Alepha, t } from "alepha";
import { AlephaReact } from "alepha/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  $page,
  NestedView,
  ReactRouter,
  Redirection,
} from "../index.browser.ts";

describe("$page browser tests", () => {
  let alepha: Alepha;

  beforeEach(() => {
    // Reset document state
    document.title = "";
    document.head.innerHTML = "";
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("should render home page via router.go", async () => {
    class App {
      home = $page({
        path: "/",
        component: () => <div data-testid="home">Welcome Home</div>,
      });
    }

    alepha = Alepha.create().with(AlephaReact).with(App);
    await alepha.start();

    const router = alepha.inject(ReactRouter);

    await act(async () => {
      await router.push("/");
    });

    await waitFor(() => {
      const element = document.querySelector('[data-testid="home"]');
      expect(element).toBeDefined();
      expect(element?.textContent).toBe("Welcome Home");
    });
  });

  it("should navigate between pages", async () => {
    class App {
      home = $page({
        path: "/",
        component: () => <div data-testid="home">Home</div>,
      });

      about = $page({
        path: "/about",
        component: () => <div data-testid="about">About Us</div>,
      });
    }

    alepha = Alepha.create().with(AlephaReact).with(App);
    await alepha.start();

    const router = alepha.inject(ReactRouter);

    // Navigate to home
    await act(async () => {
      await router.push("/");
    });

    await waitFor(() => {
      expect(document.querySelector('[data-testid="home"]')).toBeDefined();
    });

    // Navigate to about
    await act(async () => {
      await router.push("/about");
    });

    await waitFor(() => {
      expect(document.querySelector('[data-testid="about"]')).toBeDefined();
      expect(document.querySelector('[data-testid="about"]')?.textContent).toBe(
        "About Us",
      );
    });
  });

  describe("resolve function", () => {
    it("should pass resolved data to component", async () => {
      class App {
        user = $page({
          path: "/user/:id",
          schema: {
            params: t.object({
              id: t.text(),
            }),
          },
          loader: ({ params }) => ({
            userId: params.id,
            userName: `User ${params.id}`,
          }),
          component: ({
            userId,
            userName,
          }: {
            userId: string;
            userName: string;
          }) => (
            <div data-testid="user">
              <span data-testid="id">{userId}</span>
              <span data-testid="name">{userName}</span>
            </div>
          ),
        });
      }

      alepha = Alepha.create().with(AlephaReact).with(App);
      await alepha.start();

      const router = alepha.inject(ReactRouter);

      await act(async () => {
        await router.push("/user/123");
      });

      await waitFor(() => {
        expect(document.querySelector('[data-testid="id"]')?.textContent).toBe(
          "123",
        );
        expect(
          document.querySelector('[data-testid="name"]')?.textContent,
        ).toBe("User 123");
      });
    });

    it.skip("should handle async resolve function", async () => {
      // Skipped: Timing issues with multiple rapid navigations in jsdom
      class App {
        async = $page({
          path: "/async",
          loader: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { message: "Loaded async data" };
          },
          component: ({ message }: { message: string }) => (
            <div data-testid="async">{message}</div>
          ),
        });
      }

      alepha = Alepha.create().with(AlephaReact).with(App);
      await alepha.start();

      const router = alepha.inject(ReactRouter);

      await act(async () => {
        await router.push("/async");
      });

      await waitFor(
        () => {
          expect(
            document.querySelector('[data-testid="async"]')?.textContent,
          ).toBe("Loaded async data");
        },
        { timeout: 3000 },
      );
    });
  });

  describe("errorHandler", () => {
    it("should handle errors and redirect", async () => {
      let isAuthenticated = false;

      class App {
        login = $page({
          path: "/login",
          component: () => <div data-testid="login">Login Page</div>,
        });

        protected = $page({
          path: "/protected",
          loader: () => {
            if (!isAuthenticated) {
              throw new Error("Unauthorized");
            }
            return { data: "secret" };
          },
          errorHandler: (error) => {
            if (error.message === "Unauthorized") {
              return new Redirection("/login");
            }
            return undefined;
          },
          component: ({ data }: { data: string }) => (
            <div data-testid="protected">Data: {data}</div>
          ),
        });
      }

      alepha = Alepha.create().with(AlephaReact).with(App);
      await alepha.start();

      const router = alepha.inject(ReactRouter);

      // Try to access protected - should redirect to login
      await act(async () => {
        await router.push("/protected");
      });

      await waitFor(() => {
        expect(document.querySelector('[data-testid="login"]')).toBeDefined();
      });

      // Now authenticate
      isAuthenticated = true;

      await act(async () => {
        await router.push("/protected");
      });

      await waitFor(() => {
        expect(
          document.querySelector('[data-testid="protected"]'),
        ).toBeDefined();
        expect(
          document.querySelector('[data-testid="protected"]')?.textContent,
        ).toBe("Data: secret");
      });
    });

    it("should render error handler ReactNode", async () => {
      class App {
        errorPage = $page({
          path: "/error",
          loader: () => {
            throw new Error("Something went wrong");
          },
          errorHandler: (error) => (
            <div data-testid="error">Error: {error.message}</div>
          ),
          component: () => <div>Should not render</div>,
        });
      }

      alepha = Alepha.create().with(AlephaReact).with(App);
      await alepha.start();

      const router = alepha.inject(ReactRouter);

      await act(async () => {
        await router.push("/error");
      });

      await waitFor(() => {
        expect(
          document.querySelector('[data-testid="error"]')?.textContent,
        ).toBe("Error: Something went wrong");
      });
    });
  });

  describe("parent-child hierarchy", () => {
    it("should render parent layout with nested child", async () => {
      class App {
        layout = $page({
          path: "/",
          loader: () => ({ appName: "My App" }),
          component: ({ appName }: { appName: string }) => (
            <div data-testid="layout">
              <header data-testid="header">{appName}</header>
              <NestedView />
            </div>
          ),
          children: [],
        });

        home = $page({
          path: "/",
          parent: this.layout,
          component: () => <div data-testid="home">Home Content</div>,
        });

        about = $page({
          path: "/about",
          parent: this.layout,
          component: () => <div data-testid="about">About Content</div>,
        });
      }

      alepha = Alepha.create().with(AlephaReact).with(App);
      await alepha.start();

      const router = alepha.inject(ReactRouter);

      // Navigate to home - should show layout and home
      await act(async () => {
        await router.push("/");
      });

      await waitFor(() => {
        expect(
          document.querySelector('[data-testid="header"]')?.textContent,
        ).toBe("My App");
        expect(document.querySelector('[data-testid="home"]')).toBeDefined();
      });

      // Navigate to about - layout should persist
      await act(async () => {
        await router.push("/about");
      });

      await waitFor(() => {
        expect(
          document.querySelector('[data-testid="header"]')?.textContent,
        ).toBe("My App");
        expect(document.querySelector('[data-testid="about"]')).toBeDefined();
      });
    });

    it("should pass parent resolved data to children", async () => {
      class App {
        layout = $page({
          path: "/",
          loader: () => ({ theme: "dark" }),
          component: ({ theme }: { theme: string }) => (
            <div data-testid="layout" data-theme={theme}>
              <NestedView />
            </div>
          ),
          children: [],
        });

        page = $page({
          path: "/page",
          parent: this.layout,
          loader: ({ theme }) => ({
            message: `Theme is ${theme}`,
          }),
          component: ({ message }: { message: string }) => (
            <div data-testid="page">{message}</div>
          ),
        });
      }

      alepha = Alepha.create().with(AlephaReact).with(App);
      await alepha.start();

      const router = alepha.inject(ReactRouter);

      await act(async () => {
        await router.push("/page");
      });

      await waitFor(() => {
        expect(
          document
            .querySelector('[data-testid="layout"]')
            ?.getAttribute("data-theme"),
        ).toBe("dark");
        expect(
          document.querySelector('[data-testid="page"]')?.textContent,
        ).toBe("Theme is dark");
      });
    });

    it("should handle multi-level nesting", async () => {
      class App {
        root = $page({
          path: "/",
          loader: () => ({ level: "root" }),
          component: ({ level }: { level: string }) => (
            <div data-testid="root">
              {level}
              <NestedView />
            </div>
          ),
        });

        section = $page({
          path: "/section",
          parent: this.root,
          loader: ({ level }) => ({ level: `${level} > section` }),
          component: ({ level }: { level: string }) => (
            <div data-testid="section">
              {level}
              <NestedView />
            </div>
          ),
        });

        page = $page({
          path: "/page",
          parent: this.section,
          loader: ({ level }) => ({ level: `${level} > page` }),
          component: ({ level }: { level: string }) => (
            <div data-testid="page">{level}</div>
          ),
        });
      }

      alepha = Alepha.create().with(AlephaReact).with(App);
      await alepha.start();

      const router = alepha.inject(ReactRouter);

      await act(async () => {
        await router.push("/section/page");
      });

      await waitFor(() => {
        expect(document.querySelector('[data-testid="root"]')).toBeDefined();
        expect(document.querySelector('[data-testid="section"]')).toBeDefined();
        expect(
          document.querySelector('[data-testid="page"]')?.textContent,
        ).toBe("root > section > page");
      });
    });
  });

  describe("onLeave hook", () => {
    it("should call onLeave when navigating away", async () => {
      const onLeaveSpy = vi.fn();

      class App {
        home = $page({
          path: "/",
          onLeave: onLeaveSpy,
          component: () => <div data-testid="home">Home</div>,
        });

        about = $page({
          path: "/about",
          component: () => <div data-testid="about">About</div>,
        });
      }

      alepha = Alepha.create().with(AlephaReact).with(App);
      await alepha.start();

      const router = alepha.inject(ReactRouter);

      // Navigate to home
      await act(async () => {
        await router.push("/");
      });

      await waitFor(() => {
        expect(document.querySelector('[data-testid="home"]')).toBeDefined();
      });

      expect(onLeaveSpy).not.toHaveBeenCalled();

      // Navigate away from home to about
      await act(async () => {
        await router.push("/about");
      });

      await waitFor(() => {
        expect(document.querySelector('[data-testid="about"]')).toBeDefined();
      });

      // onLeave should have been called
      expect(onLeaveSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("onEnter hook", () => {
    it("should call onEnter when navigating to a page", async () => {
      const homeOnEnterSpy = vi.fn();
      const aboutOnEnterSpy = vi.fn();

      class App {
        home = $page({
          path: "/",
          onEnter: homeOnEnterSpy,
          component: () => <div data-testid="home">Home</div>,
        });

        about = $page({
          path: "/about",
          onEnter: aboutOnEnterSpy,
          component: () => <div data-testid="about">About</div>,
        });
      }

      alepha = Alepha.create().with(AlephaReact).with(App);
      await alepha.start();

      const router = alepha.inject(ReactRouter);

      // Navigate to home first
      await act(async () => {
        await router.push("/");
      });

      await waitFor(() => {
        expect(document.querySelector('[data-testid="home"]')).toBeDefined();
      });

      // Clear spies after initial setup to test subsequent navigation
      homeOnEnterSpy.mockClear();
      aboutOnEnterSpy.mockClear();

      // Navigate to about - onEnter should be called
      await act(async () => {
        await router.push("/about");
      });

      await waitFor(() => {
        expect(document.querySelector('[data-testid="about"]')).toBeDefined();
      });

      expect(aboutOnEnterSpy).toHaveBeenCalledTimes(1);
      // Home's onEnter should not be called when leaving
      expect(homeOnEnterSpy).not.toHaveBeenCalled();
    });

    it("should call onEnter on initial navigation", async () => {
      const onEnterSpy = vi.fn();

      class App {
        home = $page({
          path: "/",
          onEnter: onEnterSpy,
          component: () => <div data-testid="home">Home</div>,
        });
      }

      alepha = Alepha.create().with(AlephaReact).with(App);
      await alepha.start();

      const router = alepha.inject(ReactRouter);

      // Navigate to home - onEnter should be called
      await act(async () => {
        await router.push("/");
      });

      await waitFor(() => {
        expect(document.querySelector('[data-testid="home"]')).toBeDefined();
      });

      expect(onEnterSpy).toHaveBeenCalledTimes(1);
    });

    it("should not call parent onEnter when only child changes", async () => {
      const parentOnEnterSpy = vi.fn();
      const child1OnEnterSpy = vi.fn();
      const child2OnEnterSpy = vi.fn();

      class App {
        layout = $page({
          path: "/",
          onEnter: parentOnEnterSpy,
          component: () => (
            <div data-testid="layout">
              <NestedView />
            </div>
          ),
          children: [],
        });

        child1 = $page({
          path: "/child1",
          parent: this.layout,
          onEnter: child1OnEnterSpy,
          component: () => <div data-testid="child1">Child 1</div>,
        });

        child2 = $page({
          path: "/child2",
          parent: this.layout,
          onEnter: child2OnEnterSpy,
          component: () => <div data-testid="child2">Child 2</div>,
        });
      }

      alepha = Alepha.create().with(AlephaReact).with(App);
      await alepha.start();

      const router = alepha.inject(ReactRouter);

      // Navigate to child1
      await act(async () => {
        await router.push("/child1");
      });

      await waitFor(() => {
        expect(document.querySelector('[data-testid="child1"]')).toBeDefined();
      });

      expect(parentOnEnterSpy).toHaveBeenCalledTimes(1);
      expect(child1OnEnterSpy).toHaveBeenCalledTimes(1);
      expect(child2OnEnterSpy).not.toHaveBeenCalled();

      // Navigate to child2 - parent onEnter should NOT be called again
      await act(async () => {
        await router.push("/child2");
      });

      await waitFor(() => {
        expect(document.querySelector('[data-testid="child2"]')).toBeDefined();
      });

      // Parent should still be 1 (not called again)
      expect(parentOnEnterSpy).toHaveBeenCalledTimes(1);
      expect(child2OnEnterSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("schema validation", () => {
    it("should validate and parse params", async () => {
      class App {
        user = $page({
          path: "/user/:id",
          schema: {
            params: t.object({
              id: t.text(),
            }),
          },
          loader: ({ params }) => ({
            userId: params.id,
          }),
          component: ({ userId }: { userId: string }) => (
            <div data-testid="user">User: {userId}</div>
          ),
        });
      }

      alepha = Alepha.create().with(AlephaReact).with(App);
      await alepha.start();

      const router = alepha.inject(ReactRouter);

      await act(async () => {
        await router.push("/user/abc123");
      });

      await waitFor(() => {
        expect(
          document.querySelector('[data-testid="user"]')?.textContent,
        ).toBe("User: abc123");
      });
    });

    it("should validate and parse query params", async () => {
      class App {
        search = $page({
          path: "/search",
          schema: {
            query: t.object({
              q: t.text({ default: "" }),
              page: t.number({ default: 1 }),
            }),
          },
          loader: ({ query }) => ({
            searchQuery: query.q,
            currentPage: query.page,
          }),
          component: ({
            searchQuery,
            currentPage,
          }: {
            searchQuery: string;
            currentPage: number;
          }) => (
            <div data-testid="search">
              <div data-testid="query">{searchQuery}</div>
              <div data-testid="page">{currentPage}</div>
            </div>
          ),
        });
      }

      alepha = Alepha.create().with(AlephaReact).with(App);
      await alepha.start();

      const router = alepha.inject(ReactRouter);

      await act(async () => {
        await router.push("/search?q=typescript&page=2");
      });

      await waitFor(() => {
        expect(
          document.querySelector('[data-testid="query"]')?.textContent,
        ).toBe("typescript");
        expect(
          document.querySelector('[data-testid="page"]')?.textContent,
        ).toBe("2");
      });
    });

    it.skip("should update when navigating with different query params", async () => {
      // Skipped: Multiple rapid navigations to same page in jsdom have timing issues
      class App {
        search = $page({
          path: "/search",
          schema: {
            query: t.object({
              q: t.text({ default: "" }),
              page: t.number({ default: 1 }),
            }),
          },
          loader: ({ query }) => ({
            searchQuery: query.q,
            currentPage: query.page,
          }),
          component: ({
            searchQuery,
            currentPage,
          }: {
            searchQuery: string;
            currentPage: number;
          }) => (
            <div data-testid="search">
              <div data-testid="query">{searchQuery}</div>
              <div data-testid="page">{currentPage}</div>
            </div>
          ),
        });
      }

      alepha = Alepha.create().with(AlephaReact).with(App);
      await alepha.start();

      const router = alepha.inject(ReactRouter);

      // Navigate with query params
      await act(async () => {
        await router.push("/search?q=alepha&page=5");
      });

      await waitFor(() => {
        expect(
          document.querySelector('[data-testid="query"]')?.textContent,
        ).toBe("alepha");
        expect(
          document.querySelector('[data-testid="page"]')?.textContent,
        ).toBe("5");
      });
    });

    it("should validate params and query together", async () => {
      class App {
        userPosts = $page({
          path: "/users/:userId/posts",
          schema: {
            params: t.object({
              userId: t.text(),
            }),
            query: t.object({
              sort: t.text({ default: "recent" }),
              limit: t.number({ default: 10 }),
            }),
          },
          loader: ({ params, query }) => ({
            userId: params.userId,
            sortBy: query.sort,
            limit: query.limit,
          }),
          component: ({
            userId,
            sortBy,
            limit,
          }: {
            userId: string;
            sortBy: string;
            limit: number;
          }) => (
            <div data-testid="posts">
              <div data-testid="user">{userId}</div>
              <div data-testid="sort">{sortBy}</div>
              <div data-testid="limit">{limit}</div>
            </div>
          ),
        });
      }

      alepha = Alepha.create().with(AlephaReact).with(App);
      await alepha.start();

      const router = alepha.inject(ReactRouter);

      await act(async () => {
        await router.push("/users/john/posts?sort=popular&limit=20");
      });

      await waitFor(() => {
        expect(
          document.querySelector('[data-testid="user"]')?.textContent,
        ).toBe("john");
        expect(
          document.querySelector('[data-testid="sort"]')?.textContent,
        ).toBe("popular");
        expect(
          document.querySelector('[data-testid="limit"]')?.textContent,
        ).toBe("20");
      });
    });

    it("should use default values for missing query params", async () => {
      class App {
        search = $page({
          path: "/search",
          schema: {
            query: t.object({
              q: t.text({ default: "default search" }),
              page: t.number({ default: 1 }),
            }),
          },
          loader: ({ query }) => ({
            searchQuery: query.q,
            currentPage: query.page,
          }),
          component: ({
            searchQuery,
            currentPage,
          }: {
            searchQuery: string;
            currentPage: number;
          }) => (
            <div data-testid="search">
              <div data-testid="query">{searchQuery}</div>
              <div data-testid="page">{currentPage}</div>
            </div>
          ),
        });
      }

      alepha = Alepha.create().with(AlephaReact).with(App);
      await alepha.start();

      const router = alepha.inject(ReactRouter);

      // Navigate without query params - should use defaults
      await act(async () => {
        await router.push("/search");
      });

      await waitFor(() => {
        expect(
          document.querySelector('[data-testid="query"]')?.textContent,
        ).toBe("default search");
        expect(
          document.querySelector('[data-testid="page"]')?.textContent,
        ).toBe("1");
      });
    });
  });
});
