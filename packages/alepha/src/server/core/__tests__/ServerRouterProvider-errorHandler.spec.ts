import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { $action, ServerProvider } from "../index.ts";

class TestApp {
  internalError = $action({
    handler: () => {
      throw new Error("SELECT * FROM secret_table WHERE password = 'leaked'");
    },
  });
}

describe("ServerRouterProvider - errorHandler", () => {
  describe("in production mode", () => {
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
