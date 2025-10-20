import { AlephaCache } from "@alepha/cache";
import { Alepha } from "@alepha/core";
import { $action, AlephaServer, type ServerRequest } from "@alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AlephaServerRateLimit } from "../src/index.ts";
import { ServerRateLimitProvider } from "../src/providers/ServerRateLimitProvider.ts";

describe("ServerRateLimitProvider", () => {
  let alepha: Alepha;
  let provider: ServerRateLimitProvider;

  beforeEach(async () => {
    alepha = Alepha.create().with(AlephaCache);
    provider = alepha.inject(ServerRateLimitProvider);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const createMockRequest = (ip: string = "127.0.0.1"): ServerRequest =>
    ({
      ip,
      headers: {},
      method: "GET",
      url: "/test",
      path: "/test",
      query: {},
      params: {},
      body: undefined,
    }) as any;

  it("should allow requests within limit", async () => {
    const req = createMockRequest();
    const result = await provider.checkLimit(req, { max: 5, windowMs: 60000 });

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(5);
    expect(result.remaining).toBe(4);
  });

  it("should block requests exceeding limit", async () => {
    const req = createMockRequest();
    const options = { max: 2, windowMs: 60000 };

    // First request should be allowed
    const result1 = await provider.checkLimit(req, options);
    expect(result1.allowed).toBe(true);
    expect(result1.remaining).toBe(1);

    // Second request should be allowed
    const result2 = await provider.checkLimit(req, options);
    expect(result2.allowed).toBe(true);
    expect(result2.remaining).toBe(0);

    // Third request should be blocked
    const result3 = await provider.checkLimit(req, options);
    expect(result3.allowed).toBe(false);
    expect(result3.remaining).toBe(0);
    expect(result3.retryAfter).toBeGreaterThan(0);
  });

  it("should use custom key generator", async () => {
    const req = createMockRequest();
    const keyGenerator = (req: ServerRequest) =>
      `user:${req.headers["user-id"] || "anonymous"}`;

    const result = await provider.checkLimit(req, {
      max: 5,
      windowMs: 60000,
      keyGenerator,
    });

    expect(result.allowed).toBe(true);
  });

  it("should handle different IPs separately", async () => {
    const req1 = createMockRequest("192.168.1.1");
    const req2 = createMockRequest("192.168.1.2");
    const options = { max: 1, windowMs: 60000 };

    // Both requests should be allowed as they come from different IPs
    const result1 = await provider.checkLimit(req1, options);
    const result2 = await provider.checkLimit(req2, options);

    expect(result1.allowed).toBe(true);
    expect(result2.allowed).toBe(true);
  });

  it("should extract IP from x-forwarded-for header", async () => {
    const req = createMockRequest();
    req.headers["x-forwarded-for"] = "203.0.113.1, 192.168.1.1";

    const result = await provider.checkLimit(req, { max: 5, windowMs: 60000 });
    expect(result.allowed).toBe(true);
  });
});

describe("ServerRateLimitProvider Module Integration", () => {
  let alepha: Alepha;
  let provider: ServerRateLimitProvider;

  class TestApp {
    test = $action({
      handler: () => "success",
    });
  }

  beforeEach(async () => {
    alepha = Alepha.create()
      .with(AlephaCache)
      .with(AlephaServer)
      .with(AlephaServerRateLimit)
      .with(TestApp);
    provider = alepha.inject(ServerRateLimitProvider);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  it("should integrate with Alepha framework successfully", async () => {
    expect(provider).toBeDefined();
    expect(provider).toBeInstanceOf(ServerRateLimitProvider);
    expect(provider.options).toBeDefined();
    expect(typeof provider.checkLimit).toBe("function");
  });

  it("should have configurable options", async () => {
    const newOptions = { max: 50, windowMs: 30000 };
    provider.options = newOptions;

    expect(provider.options).toEqual(newOptions);
  });

  it("should work with real action requests", async () => {
    // Configure rate limit for testing
    provider.options = { max: 10, windowMs: 60000 };

    const app = alepha.inject(TestApp);

    // First request should succeed
    const result = await app.test.run({});
    expect(result).toBe("success");

    // Multiple requests should still work within limit
    for (let i = 0; i < 5; i++) {
      const result = await app.test.run({});
      expect(result).toBe("success");
    }
  });
});
