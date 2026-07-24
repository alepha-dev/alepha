import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { $action, HttpError, ServerProvider } from "../index.ts";

class TestApp {
  internalError = $action({
    handler: () => {
      throw new Error("SELECT * FROM secret_table WHERE password = 'leaked'");
    },
  });

  /**
   * A 5xx HttpError carrying an internal cause — the branch that bypassed
   * sanitization entirely, shipping `cause` (name + message) to the client.
   */
  wrappedInternalError = $action({
    handler: () => {
      throw new HttpError(
        { status: 502, message: "Upstream failed" },
        new Error("postgres://user:hunter2@db.internal:5432 refused"),
      );
    },
  });

  /**
   * A 4xx HttpError — its cause is intentional, client-facing context and
   * must survive sanitization.
   */
  badRequest = $action({
    handler: () => {
      throw new HttpError(
        { status: 400, message: "Invalid payload" },
        new Error("field 'age' must be a number"),
      );
    },
  });
}

describe("ServerRouterProvider - errorHandler", () => {
  describe("in production mode", () => {
    it("should not leak an HttpError cause on 5xx", async ({ expect }) => {
      const alepha = Alepha.create({
        env: {
          NODE_ENV: "production",
          SERVER_PORT: 0,
          APP_SECRET: "test-secret",
        },
      }).with(TestApp);

      await alepha.start();
      const hostname = alepha.inject(ServerProvider).hostname;

      const response = await fetch(`${hostname}/api/wrappedInternalError`);
      const json = await response.json();
      const body = JSON.stringify(json);

      expect(response.status).toBe(502);
      expect(body).not.toContain("hunter2");
      expect(body).not.toContain("db.internal");
      expect(json.cause).toBeUndefined();

      await alepha.stop();
    });

    it("should keep the cause on 4xx (intentional, client-facing)", async ({
      expect,
    }) => {
      const alepha = Alepha.create({
        env: {
          NODE_ENV: "production",
          SERVER_PORT: 0,
          APP_SECRET: "test-secret",
        },
      }).with(TestApp);

      await alepha.start();
      const hostname = alepha.inject(ServerProvider).hostname;

      const response = await fetch(`${hostname}/api/badRequest`);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(JSON.stringify(json)).toContain("age");

      await alepha.stop();
    });

    it("should not leak error details in 500 response", async ({ expect }) => {
      const alepha = Alepha.create({
        env: {
          NODE_ENV: "production",
          SERVER_PORT: 0,
          APP_SECRET: "test-secret",
        },
      }).with(TestApp);

      await alepha.start();
      const hostname = alepha.inject(ServerProvider).hostname;

      const response = await fetch(`${hostname}/api/internalError`);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.message).toBe("Internal Server Error");
      expect(json.message).not.toContain("secret_table");
      expect(json.error).toBe("InternalServerError");

      await alepha.stop();
    });
  });

  describe("in development mode", () => {
    it("should include error details in 500 response", async ({ expect }) => {
      const alepha = Alepha.create().with(TestApp);

      await alepha.start();
      const hostname = alepha.inject(ServerProvider).hostname;

      const response = await fetch(`${hostname}/api/internalError`);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.message).toContain("secret_table");
      expect(json.error).toBe("InternalServerError");

      await alepha.stop();
    });
  });
});
