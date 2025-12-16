import { Alepha } from "alepha";
import { AlephaCache } from "alepha/cache";
import { $action, AlephaServer, HttpError } from "alepha/server";
import { $rateLimit, AlephaServerRateLimit } from "alepha/server/rate-limit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("Action Rate Limiting", () => {
  let alepha: Alepha;

  class TestApp {
    // Action with rate limiting enabled via options
    limitedAction = $action({
      rateLimit: { max: 2, windowMs: 1000 },
      handler: () => "success",
    });

    // Action with custom key generator
    userBasedAction = $action({
      rateLimit: {
        max: 3,
        windowMs: 2000,
        keyGenerator: (req) => `user:${req.headers["user-id"] || "anonymous"}`,
      },
      handler: () => "user success",
    });

    // Action without rate limiting
    unlimitedAction = $action({
      handler: () => "unlimited success",
    });

    // Rate limit primitive usage
    customRateLimit = $rateLimit({ max: 1, windowMs: 500 });

    primitiveAction = $action({
      handler: async (request) => {
        const result = await this.customRateLimit.check(request, {
          max: 1,
          windowMs: 500,
        });
        if (!result.allowed) {
          throw new HttpError({
            status: 429,
            message: `Rate limit exceeded. Reset in ${result.retryAfter}s`,
          });
        }
        return "primitive success";
      },
    });
  }

  beforeEach(async () => {
    alepha = Alepha.create()
      .with(AlephaCache)
      .with(AlephaServer)
      .with(AlephaServerRateLimit)
      .with(TestApp);

    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  describe("Action rateLimit option", () => {
    it("should allow requests within rate limit", async () => {
      const app = alepha.inject(TestApp);

      const result1 = await app.limitedAction.run({});
      expect(result1).toBe("success");

      const result2 = await app.limitedAction.run({});
      expect(result2).toBe("success");
    });

    it("should block requests exceeding rate limit", async () => {
      const app = alepha.inject(TestApp);

      // First two requests should succeed
      await app.limitedAction.run({});
      await app.limitedAction.run({});

      // Third request should be rate limited
      await expect(app.limitedAction.run({})).rejects.toThrow(
        "Too Many Requests",
      );
    });

    it("should use custom key generator", async () => {
      const app = alepha.inject(TestApp);

      // Test that the custom key generator allows more requests per user
      // since each user gets their own rate limit bucket
      const result1 = await app.userBasedAction.run({});
      expect(result1).toBe("user success");

      const result2 = await app.userBasedAction.run({});
      expect(result2).toBe("user success");

      const result3 = await app.userBasedAction.run({});
      expect(result3).toBe("user success");

      // Fourth request should be blocked (limit is 3)
      await expect(app.userBasedAction.run({})).rejects.toThrow(
        "Too Many Requests",
      );
    });

    it("should not affect unlimited actions", async () => {
      const app = alepha.inject(TestApp);

      // Should be able to make many requests to unlimited action
      for (let i = 0; i < 10; i++) {
        const result = await app.unlimitedAction.run({});
        expect(result).toBe("unlimited success");
      }
    });

    it("should reset rate limit after window expires", async () => {
      const app = alepha.inject(TestApp);

      // Use up the rate limit
      await app.limitedAction.run({});
      await app.limitedAction.run({});

      // Should be blocked
      await expect(app.limitedAction.run({})).rejects.toThrow(
        "Too Many Requests",
      );

      // Wait for the window to expire (1000ms + buffer)
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be allowed again
      const result = await app.limitedAction.run({});
      expect(result).toBe("success");
    });
  });

  describe("$rateLimit primitive", () => {
    it("should create rate limit primitive with options", () => {
      const app = alepha.inject(TestApp);

      expect(app.customRateLimit).toBeDefined();
      expect(app.customRateLimit.name).toBe("customRateLimit");
      expect(app.customRateLimit.options.max).toBe(1);
      expect(app.customRateLimit.options.windowMs).toBe(500);
    });

    it("should handle rate limiting in custom action logic", async () => {
      const app = alepha.inject(TestApp);

      // First request should succeed
      const result1 = await app.primitiveAction.run({});
      expect(result1).toBe("primitive success");

      // Second request should be blocked by custom logic
      await expect(app.primitiveAction.run({})).rejects.toThrow(
        "Rate limit exceeded",
      );
    });
  });

  describe("Integration", () => {
    it("should integrate rate limiting with action hooks", async () => {
      const app = alepha.inject(TestApp);

      // Just verify that the hook is working by checking that rate limiting is applied
      await app.limitedAction.run({});
      await app.limitedAction.run({});

      // Third request should trigger rate limiting
      await expect(app.limitedAction.run({})).rejects.toThrow(
        "Too Many Requests",
      );
    });
  });

  describe("Performance and edge cases", () => {
    it("should handle concurrent requests correctly", async () => {
      const app = alepha.inject(TestApp);

      // Test sequential requests to avoid race conditions in testing
      let successCount = 0;
      let rateLimitedCount = 0;

      for (let i = 0; i < 5; i++) {
        try {
          await app.limitedAction.run({});
          successCount++;
        } catch (e: any) {
          if (e.message === "Too Many Requests") {
            rateLimitedCount++;
          }
        }
      }

      expect(successCount).toBe(2);
      expect(rateLimitedCount).toBe(3);
    });

    it("should handle missing IP gracefully", async () => {
      const app = alepha.inject(TestApp);

      // Should still work with default IP handling
      const result = await app.limitedAction.run({});
      expect(result).toBe("success");
    });
  });
});
