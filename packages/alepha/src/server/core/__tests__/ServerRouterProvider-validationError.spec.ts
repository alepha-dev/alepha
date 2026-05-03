import { Alepha, t } from "alepha";
import { describe, it } from "vitest";
import { $route, ServerProvider } from "../index.ts";

class TestApp {
  createUser = $route({
    method: "POST",
    path: "/users",
    schema: {
      body: t.object({
        name: t.text(),
        age: t.integer(),
      }),
    },
    handler: () => {},
  });

  getUser = $route({
    method: "GET",
    path: "/users/:id",
    schema: {
      params: t.object({
        id: t.integer(),
      }),
    },
    handler: () => {},
  });

  searchUsers = $route({
    method: "GET",
    path: "/users",
    schema: {
      query: t.object({
        limit: t.integer({ minimum: 1, maximum: 100 }),
      }),
    },
    handler: () => {},
  });

  protectedRoute = $route({
    method: "GET",
    path: "/protected",
    schema: {
      headers: t.object({
        "x-api-version": t.integer(),
      }),
    },
    handler: () => {},
  });
}

const fetchAndStop = async (
  alepha: Alepha,
  build: (hostname: string) => { url: string; init?: RequestInit },
) => {
  await alepha.start();
  const hostname = alepha.inject(ServerProvider).hostname;
  const { url, init } = build(hostname);
  const response = await fetch(url, init);
  const json = await response.json();
  await alepha.stop();
  return { response, json };
};

describe("ServerRouterProvider - request validation error", () => {
  describe("body validation", () => {
    it("should expose a wrong-type rejection (expected integer, got string)", async ({
      expect,
    }) => {
      const alepha = Alepha.create({
        env: { NODE_ENV: "production", SERVER_PORT: 0 },
      }).with(TestApp);

      const { response, json } = await fetchAndStop(alepha, (host) => ({
        url: `${host}/users`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "John", age: "not-a-number" }),
        },
      }));

      expect(response.status).toBe(400);
      expect(json.error).toBe("ValidationError");
      expect(json.message).toMatch(/^Invalid request body:/);
      expect(json.message.toLowerCase()).toMatch(/integer|expected/);
      // path locates the offending field
      expect(json.details).toBe("/age");
    });

    it("should expose a missing-field rejection (required property `age`)", async ({
      expect,
    }) => {
      const alepha = Alepha.create({
        env: { NODE_ENV: "production", SERVER_PORT: 0 },
      }).with(TestApp);

      const { response, json } = await fetchAndStop(alepha, (host) => ({
        url: `${host}/users`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "John" }),
        },
      }));

      expect(response.status).toBe(400);
      expect(json.error).toBe("ValidationError");
      expect(json.message).toMatch(/^Invalid request body:/);
      // message must name the missing field
      expect(json.message).toContain("age");
      expect(json.message.toLowerCase()).toMatch(/required/);
    });

    it("should behave identically in development mode", async ({ expect }) => {
      const alepha = Alepha.create().with(TestApp);

      const { response, json } = await fetchAndStop(alepha, (host) => ({
        url: `${host}/users`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "John" }),
        },
      }));

      expect(response.status).toBe(400);
      expect(json.error).toBe("ValidationError");
      expect(json.message).toMatch(/^Invalid request body:/);
      expect(json.message.toLowerCase()).toMatch(/age|required/);
    });
  });

  describe("params validation", () => {
    it("should expose the rejection reason in production", async ({
      expect,
    }) => {
      const alepha = Alepha.create({
        env: { NODE_ENV: "production", SERVER_PORT: 0 },
      }).with(TestApp);

      const { response, json } = await fetchAndStop(alepha, (host) => ({
        url: `${host}/users/not-a-number`,
      }));

      expect(response.status).toBe(400);
      expect(json.error).toBe("ValidationError");
      expect(json.message).toMatch(/^Invalid request params:/);
      expect(json.message.toLowerCase()).toMatch(/integer|number|expected/);
    });
  });

  describe("query validation", () => {
    it("should expose the rejection reason in production", async ({
      expect,
    }) => {
      const alepha = Alepha.create({
        env: { NODE_ENV: "production", SERVER_PORT: 0 },
      }).with(TestApp);

      const { response, json } = await fetchAndStop(alepha, (host) => ({
        url: `${host}/users?limit=9999`,
      }));

      expect(response.status).toBe(400);
      expect(json.error).toBe("ValidationError");
      expect(json.message).toMatch(/^Invalid request query:/);
      expect(json.message.toLowerCase()).toMatch(/maximum|less|<=|100/);
    });
  });

  describe("header validation", () => {
    it("should expose the rejection reason in production", async ({
      expect,
    }) => {
      const alepha = Alepha.create({
        env: { NODE_ENV: "production", SERVER_PORT: 0 },
      }).with(TestApp);

      const { response, json } = await fetchAndStop(alepha, (host) => ({
        url: `${host}/protected`,
        // omit required header
      }));

      expect(response.status).toBe(400);
      expect(json.error).toBe("ValidationError");
      expect(json.message).toMatch(/^Invalid request header:/);
      expect(json.message.toLowerCase()).toMatch(/x-api-version|required/);
    });
  });
});
