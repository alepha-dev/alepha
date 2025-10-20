import { beforeEach, describe, expect, test } from "vitest";
import { RouterProvider } from "../src/providers/RouterProvider.ts";

interface TestRoute {
  path: string;
  name: string;
  mapping?: Record<string, string>;
}

class TestRouterProvider extends RouterProvider<TestRoute> {
  public push(route: TestRoute) {
    super.push(route);
  }
}

// A type-safe helper to create the router instance for tests
const setupRouter = () => {
  const router = new TestRouterProvider();

  const add = (path: string, name: string) => {
    router.push({ path, name });
  };

  const match = (path: string) => {
    const { route, params } = router.match(path);
    return {
      name: route?.name ?? null, // Use null for clarity on no-match
      params: params ?? {},
    };
  };

  return { router, add, match };
};

describe("match", () => {
  let router: RouterProvider<{ name: string; path: string }>;
  let add: (path: string, name: string) => void;
  let match: (path: string) => {
    name: string | null;
    params: Record<string, string>;
  };

  beforeEach(() => {
    const setup = setupRouter();
    router = setup.router;
    add = setup.add;
    match = setup.match;
  });

  describe("Static Routing", () => {
    test("should match basic static routes", () => {
      add("/", "home");
      add("/about", "about");
      add("/contact-us", "contact");

      expect(match("/")).toEqual({ name: "home", params: {} });
      expect(match("/about")).toEqual({ name: "about", params: {} });
      expect(match("/contact-us")).toEqual({ name: "contact", params: {} });
    });

    test("should handle nested static routes", () => {
      add("/dashboard/settings/profile", "profile_settings");
      expect(match("/dashboard/settings/profile")).toEqual({
        name: "profile_settings",
        params: {},
      });
    });

    test("should be case-insensitive for static parts", () => {
      add("/Case/Sensitive/Path", "case_path");
      expect(match("/case/sensitive/path")).toEqual({
        name: "case_path",
        params: {},
      });
      expect(match("/CASE/SENSITIVE/PATH")).toEqual({
        name: "case_path",
        params: {},
      });
    });

    test("should handle trailing slashes", () => {
      add("/about/", "about_with_slash");
      add("/contact", "contact_no_slash");

      expect(match("/about")).toEqual({ name: "about_with_slash", params: {} });
      expect(match("/contact/")).toEqual({
        name: "contact_no_slash",
        params: {},
      });
    });

    test("should ignore query parameters when matching", () => {
      add("/search", "search_page");
      expect(match("/search?q=alepha&page=1")).toEqual({
        name: "search_page",
        params: {},
      });
    });
  });

  describe("Parameter Routing", () => {
    test("should match a single parameter", () => {
      add("/posts/:slug", "post_by_slug");
      expect(match("/posts/hello-world")).toEqual({
        name: "post_by_slug",
        params: { slug: "hello-world" },
      });
    });

    test("should match multiple parameters in a route", () => {
      add("/products/:category/:productId", "product_details");
      expect(match("/products/electronics/12345")).toEqual({
        name: "product_details",
        params: { category: "electronics", productId: "12345" },
      });
    });

    test("should maintain case for parameter values", () => {
      add("/users/:username", "user_profile");
      expect(match("/users/JohnDoe")).toEqual({
        name: "user_profile",
        params: { username: "JohnDoe" },
      });
    });

    test("should prefer a static route over a parameterized one at the same level", () => {
      add("/team/:member", "team_member");
      add("/team/new", "team_new");

      expect(match("/team/new")).toEqual({ name: "team_new", params: {} });
      expect(match("/team/jane")).toEqual({
        name: "team_member",
        params: { member: "jane" },
      });
    });
  });

  describe("Double Parameter Mapping (The Fix)", () => {
    test("should correctly map different parameter names at the same level", () => {
      add("/users/:id", "user_by_id");
      add("/users/:userId/posts", "posts_by_userId");
      add("/users/:user_id/posts/:postId", "post_by_user_id_and_post_id");

      // Test first route
      const match1 = match("/users/123");
      expect(match1).toEqual({ name: "user_by_id", params: { id: "123" } });

      // Test second route, ensuring `userId` is mapped correctly from `id`
      const match2 = match("/users/abc/posts");
      expect(match2).toEqual({
        name: "posts_by_userId",
        params: { userId: "abc" },
      });

      // Test third route with two mappings
      const match3 = match("/users/abc/posts/xyz");
      expect(match3).toEqual({
        name: "post_by_user_id_and_post_id",
        params: { user_id: "abc", postId: "xyz" },
      });
    });

    test("should handle a mix of static and mapped params", () => {
      add("/api/v1/items/:id", "get_item");
      add("/api/v1/items/:itemId/details", "get_item_details");

      expect(match("/api/v1/items/42")).toEqual({
        name: "get_item",
        params: { id: "42" },
      });
      expect(match("/api/v1/items/42/details")).toEqual({
        name: "get_item_details",
        params: { itemId: "42" },
      });
    });
  });

  describe("Wildcard Routing", () => {
    test("should match a final wildcard", () => {
      add("/files/*", "file_path");
      expect(match("/files/documents/report.pdf")).toEqual({
        name: "file_path",
        params: { "*": "documents/report.pdf" },
      });
    });

    test("should match a root-level wildcard", () => {
      add("/*", "catch_all");
      expect(match("/anything/goes/here")).toEqual({
        name: "catch_all",
        params: { "*": "anything/goes/here" },
      });
      // An empty path for the wildcard
      expect(match("/")).toEqual({ name: "catch_all", params: { "*": "" } });
    });

    test("should prefer a more specific route over a wildcard", () => {
      add("/*", "catch_all");
      add("/about", "about_page");
      add("/users/:id", "user_page");

      expect(match("/about")).toEqual({ name: "about_page", params: {} });
      expect(match("/users/1")).toEqual({
        name: "user_page",
        params: { id: "1" },
      });
      expect(match("/something-else")).toEqual({
        name: "catch_all",
        params: { "*": "something-else" },
      });
    });

    test("should handle wildcards after a parameter", () => {
      add("/proxy/:service/*", "service_proxy");
      expect(match("/proxy/auth-service/api/v2/login")).toEqual({
        name: "service_proxy",
        params: { service: "auth-service", "*": "api/v2/login" },
      });
    });
  });

  describe("Error Handling and Edge Cases", () => {
    test("should return null if no route matches", () => {
      add("/home", "home");
      expect(match("/nonexistent")).toEqual({ name: null, params: {} });
    });

    test("should throw an error for invalid route paths during push", () => {
      // Does not start with '/'
      expect(() => add("no-slash", "invalid")).toThrow();
      // Invalid character '*'
      expect(() => add("/invalid*path", "invalid")).toThrow();
      // Parameter without a name
      expect(() => add("/users/:/details", "invalid")).toThrow();
      // Wildcard not at the end
      expect(() => add("/files/*/more", "invalid")).toThrow();
      // Double wildcard
      expect(() => add("/files/**", "invalid")).toThrow();
      // Empty parameter name
      expect(() => add("/items/{}/info", "invalid")).toThrow();
    });

    test("should throw an error for invalid paths during match", () => {
      expect(() => match("not-a-valid-path")).toThrow();
    });

    test("should handle empty path parts correctly", () => {
      add("/a//b", "double_slash"); // Should be treated as /a/b
      expect(match("/a/b")).toEqual({ name: "double_slash", params: {} });
    });
  });
});
