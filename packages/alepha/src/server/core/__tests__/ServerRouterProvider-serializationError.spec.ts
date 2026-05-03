import { Alepha, t } from "alepha";
import { describe, it } from "vitest";
import { $action, ServerProvider } from "../index.ts";

class TestApp {
  badResponse = $action({
    schema: {
      response: t.object({
        name: t.text(),
        age: t.integer(),
      }),
    },
    handler: () =>
      ({
        // missing required `age` → response codec.encode will throw
        name: "John",
        secretToken: "leaked-token-xyz",
      }) as any,
  });
}

describe("ServerRouterProvider - response serialization error", () => {
  describe("in production mode", () => {
    it("should not leak validation details or response payload in 500 response", async ({
      expect,
    }) => {
      const alepha = Alepha.create({
        env: { NODE_ENV: "production", SERVER_PORT: 0 },
      }).with(TestApp);

      await alepha.start();
      const hostname = alepha.inject(ServerProvider).hostname;

      const response = await fetch(`${hostname}/api/badResponse`);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.error).toBe("InternalServerError");
      expect(json.message).toBe("Internal Server Error");

      // payload from the handler must not leak through the error
      const dump = JSON.stringify(json);
      expect(dump).not.toContain("leaked-token-xyz");
      expect(dump).not.toContain("secretToken");

      await alepha.stop();
    });
  });

  describe("in development mode", () => {
    it("should include explicit validation details in 500 response", async ({
      expect,
    }) => {
      const alepha = Alepha.create().with(TestApp);

      await alepha.start();
      const hostname = alepha.inject(ServerProvider).hostname;

      const response = await fetch(`${hostname}/api/badResponse`);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.error).toBe("InternalServerError");

      // dev mode must surface enough context to debug the schema mismatch
      expect(json.message).not.toBe("Internal Server Error");
      expect(json.message.toLowerCase()).toMatch(/age|required|expected/);

      // even in dev, the raw handler payload (potential secrets) must not be echoed
      expect(json.message).not.toContain("leaked-token-xyz");

      await alepha.stop();
    });
  });
});
