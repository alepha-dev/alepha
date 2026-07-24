import { Alepha, z } from "alepha";
import { describe, it } from "vitest";
import { $route, ServerProvider } from "../index.ts";

class TestApp {
  createUser = $route({
    method: "POST",
    path: "/users",
    schema: {
      body: z.object({
        name: z.text(),
        age: z.integer(),
      }),
    },
    handler: () => {},
  });

  getUser = $route({
    method: "GET",
    path: "/users/:id",
    schema: {
      params: z.object({
        id: z.integer(),
      }),
    },
    handler: () => {},
  });

  searchUsers = $route({
    method: "GET",
    path: "/users",
    schema: {
      query: z.object({
        limit: z.integer().min(1).max(100),
      }),
    },
    handler: () => {},
  });

  protectedRoute = $route({
    method: "GET",
    path: "/protected",
    schema: {
      headers: z.object({
        "x-api-version": z.integer(),
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
        env: {
          NODE_ENV: "production",
          SERVER_PORT: 0,
          APP_SECRET: "test-secret",
        },
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
        env: {
          NODE_ENV: "production",
          SERVER_PORT: 0,
          APP_SECRET: "test-secret",
        },
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
        env: {
          NODE_ENV: "production",
          SERVER_PORT: 0,
          APP_SECRET: "test-secret",
        },
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
        env: {
          NODE_ENV: "production",
          SERVER_PORT: 0,
          APP_SECRET: "test-secret",
        },
      }).with(TestApp);

      const { response, json } = await fetchAndStop(alepha, (host) => ({
        url: `${host}/users?limit=9999`,
      }));

      expect(response.status).toBe(400);
      expect(json.error).toBe("ValidationError");
      expect(json.message).toMatch(/^Invalid request query:/);
      expect(json.message.toLowerCase()).toMatch(/maximum|less|<=|100/);
    });

    it("should reject a missing required query parameter", async ({
      expect,
    }) => {
      const alepha = Alepha.create({
        env: {
          NODE_ENV: "production",
          SERVER_PORT: 0,
          APP_SECRET: "test-secret",
        },
      }).with(TestApp);

      // `limit` is required — omitting it must be a 400, not a handler
      // running with `query.limit === undefined`.
      const { response, json } = await fetchAndStop(alepha, (host) => ({
        url: `${host}/users`,
      }));

      expect(response.status).toBe(400);
      expect(json.error).toBe("ValidationError");
      expect(json.message).toMatch(/^Invalid request query:/);
      expect(json.message).toContain("limit");
    });
  });

  describe("header validation", () => {
    it("should expose the rejection reason in production", async ({
      expect,
    }) => {
      const alepha = Alepha.create({
        env: {
          NODE_ENV: "production",
          SERVER_PORT: 0,
          APP_SECRET: "test-secret",
        },
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

    it("should coerce string header values to declared schema types", async ({
      expect,
    }) => {
      const seen: { version?: unknown } = {};
      class CoerceApp {
        captured = $route({
          method: "GET",
          path: "/coerce",
          schema: {
            headers: z.object({
              "x-api-version": z.integer(),
            }),
          },
          handler: ({ headers }) => {
            seen.version = headers["x-api-version"];
          },
        });
      }

      const alepha = Alepha.create({
        env: {
          NODE_ENV: "production",
          SERVER_PORT: 0,
          APP_SECRET: "test-secret",
        },
      }).with(CoerceApp);

      await alepha.start();
      const host = alepha.inject(ServerProvider).hostname;
      const response = await fetch(`${host}/coerce`, {
        headers: { "x-api-version": "42" },
      });
      await alepha.stop();

      expect([200, 204]).toContain(response.status);
      expect(seen.version).toBe(42);
      expect(typeof seen.version).toBe("number");
    });

    it("should preserve undeclared headers (auth, user-agent, ...)", async ({
      expect,
    }) => {
      const seen: { authorization?: string; userAgent?: string } = {};
      class PreserveApp {
        check = $route({
          method: "GET",
          path: "/preserve",
          schema: {
            headers: z.object({
              "x-api-version": z.integer(),
            }),
          },
          handler: ({ headers }) => {
            const all = headers as unknown as Record<string, string>;
            seen.authorization = all.authorization;
            seen.userAgent = all["user-agent"];
          },
        });
      }

      const alepha = Alepha.create({
        env: {
          NODE_ENV: "production",
          SERVER_PORT: 0,
          APP_SECRET: "test-secret",
        },
      }).with(PreserveApp);

      await alepha.start();
      const host = alepha.inject(ServerProvider).hostname;
      const response = await fetch(`${host}/preserve`, {
        headers: {
          "x-api-version": "1",
          authorization: "Bearer abc.def.ghi",
          "user-agent": "MyClient/1.0",
        },
      });
      await alepha.stop();

      expect([200, 204]).toContain(response.status);
      expect(seen.authorization).toBe("Bearer abc.def.ghi");
      expect(seen.userAgent).toBe("MyClient/1.0");
    });

    it("should accept schema keys regardless of case (lowercase normalization)", async ({
      expect,
    }) => {
      const seen: { version?: unknown } = {};
      class CaseApp {
        // Schema declares keys with mixed case — Node lowercases incoming
        // header names, so the framework must lowercase schema keys when
        // matching values.
        check = $route({
          method: "GET",
          path: "/case",
          schema: {
            headers: z.object({
              "X-Api-Version": z.integer(),
            }),
          },
          handler: ({ headers }) => {
            seen.version = (headers as Record<string, unknown>)[
              "x-api-version"
            ];
          },
        });
      }

      const alepha = Alepha.create({
        env: {
          NODE_ENV: "production",
          SERVER_PORT: 0,
          APP_SECRET: "test-secret",
        },
      }).with(CaseApp);

      await alepha.start();
      const host = alepha.inject(ServerProvider).hostname;
      const response = await fetch(`${host}/case`, {
        headers: { "x-api-version": "7" },
      });
      await alepha.stop();

      expect([200, 204]).toContain(response.status);
      expect(seen.version).toBe(7);
    });
  });
});
