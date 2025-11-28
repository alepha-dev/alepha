import { Alepha } from "alepha";
import { AlephaCache } from "alepha/cache";
import {
  $action,
  AlephaServer,
  ServerProvider,
  type ServerRequest,
} from "alepha/server";
import { afterEach, beforeEach, describe, expect, it, test } from "vitest";
import {
  $rateLimit,
  AlephaServerRateLimit,
} from "../../src/server-rate-limit/index.ts";
import {
  rateLimitOptions,
  ServerRateLimitProvider,
} from "../../src/server-rate-limit/providers/ServerRateLimitProvider.ts";

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
    const options = { max: 1, windowMs: 60000 };

    // First request with x-forwarded-for: 203.0.113.1
    const req1 = createMockRequest("127.0.0.1");
    req1.headers["x-forwarded-for"] = "203.0.113.1, 192.168.1.1";

    const result1 = await provider.checkLimit(req1, options);
    expect(result1.allowed).toBe(true);

    // Second request with same x-forwarded-for should be blocked
    const req2 = createMockRequest("127.0.0.1");
    req2.headers["x-forwarded-for"] = "203.0.113.1, 192.168.1.1";

    const result2 = await provider.checkLimit(req2, options);
    expect(result2.allowed).toBe(false);

    // Request with different x-forwarded-for should be allowed
    const req3 = createMockRequest("127.0.0.1");
    req3.headers["x-forwarded-for"] = "198.51.100.1, 192.168.1.1";

    const result3 = await provider.checkLimit(req3, options);
    expect(result3.allowed).toBe(true);
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
    expect(typeof provider.checkLimit).toBe("function");
  });

  it("should work with real action requests", async () => {
    // Configure rate limit for testing
    alepha.state.mut(rateLimitOptions, () => ({
      max: 10,
      windowMs: 60000,
    }));

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

// ---------------------------------------------------------------------------------------------------------------------

describe("$rateLimit descriptor", () => {
  let alepha: Alepha;
  let server: ServerProvider;

  afterEach(async () => {
    if (alepha) {
      await alepha.stop();
    }
  });

  test("should apply path-specific rate limit to matching routes", async () => {
    class AppWithRateLimit {
      // Path-specific rate limit for /api/v1/* routes
      apiRateLimit = $rateLimit({
        paths: ["/api/v1/*"],
        max: 2,
        windowMs: 60000,
      });

      // $action with path "/v1/data" creates route at "/api/v1/data"
      apiAction = $action({
        path: "/v1/data",
        method: "POST",
        handler: () => "success",
      });
    }

    alepha = Alepha.create()
      .with(AlephaCache)
      .with(AlephaServer)
      .with(AlephaServerRateLimit)
      .with(AppWithRateLimit);

    server = alepha.inject(ServerProvider);
    await alepha.start();

    // First two requests should succeed
    const response1 = await fetch(`${server.hostname}/api/v1/data`, {
      method: "POST",
    });
    expect(response1.status).toBe(200);
    expect(response1.headers.get("x-ratelimit-limit")).toBe("2");
    expect(response1.headers.get("x-ratelimit-remaining")).toBe("1");

    const response2 = await fetch(`${server.hostname}/api/v1/data`, {
      method: "POST",
    });
    expect(response2.status).toBe(200);
    expect(response2.headers.get("x-ratelimit-remaining")).toBe("0");

    // Third request should be rate limited
    const response3 = await fetch(`${server.hostname}/api/v1/data`, {
      method: "POST",
    });
    expect(response3.status).toBe(429);
    expect(response3.headers.get("retry-after")).toBeDefined();
  });

  test("should register rate limit configs with provider", async () => {
    class RegistrationApp {
      limit1 = $rateLimit({
        name: "api-limit",
        paths: ["/api/*"],
        max: 100,
      });

      limit2 = $rateLimit({
        name: "admin-limit",
        paths: ["/admin/*"],
        max: 10,
      });
    }

    alepha = Alepha.create()
      .with(AlephaCache)
      .with(AlephaServer)
      .with(AlephaServerRateLimit)
      .with(RegistrationApp);

    const rateLimitProvider = alepha.inject(ServerRateLimitProvider);
    await alepha.start();

    expect(rateLimitProvider.registeredConfigs).toHaveLength(2);
    expect(rateLimitProvider.registeredConfigs[0].name).toBe("api-limit");
    expect(rateLimitProvider.registeredConfigs[1].name).toBe("admin-limit");
  });

  test("should apply different rate limits to different paths", async () => {
    class MultiRateLimitApp {
      // Strict limit for admin routes
      adminLimit = $rateLimit({
        paths: ["/api/admin/*"],
        max: 1,
        windowMs: 60000,
      });

      // Lenient limit for public routes
      publicLimit = $rateLimit({
        paths: ["/api/public/*"],
        max: 10,
        windowMs: 60000,
      });

      adminAction = $action({
        path: "/admin/users",
        method: "GET",
        handler: () => "admin",
      });

      publicAction = $action({
        path: "/public/status",
        method: "GET",
        handler: () => "public",
      });
    }

    alepha = Alepha.create()
      .with(AlephaCache)
      .with(AlephaServer)
      .with(AlephaServerRateLimit)
      .with(MultiRateLimitApp);

    server = alepha.inject(ServerProvider);
    await alepha.start();

    // Admin route should have max: 1
    const adminResponse1 = await fetch(`${server.hostname}/api/admin/users`);
    expect(adminResponse1.status).toBe(200);
    expect(adminResponse1.headers.get("x-ratelimit-limit")).toBe("1");

    // Second admin request should be rate limited
    const adminResponse2 = await fetch(`${server.hostname}/api/admin/users`);
    expect(adminResponse2.status).toBe(429);

    // Public route should have max: 10
    const publicResponse = await fetch(`${server.hostname}/api/public/status`);
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("x-ratelimit-limit")).toBe("10");
  });

  test("should handle multiple paths in single $rateLimit descriptor", async () => {
    class MultiPathApp {
      apiLimit = $rateLimit({
        paths: ["/api/v1/*", "/api/v2/*"],
        max: 5,
        windowMs: 60000,
      });

      action1 = $action({
        path: "/v1/data",
        method: "GET",
        handler: () => "v1",
      });

      action2 = $action({
        path: "/v2/data",
        method: "GET",
        handler: () => "v2",
      });
    }

    alepha = Alepha.create()
      .with(AlephaCache)
      .with(AlephaServer)
      .with(AlephaServerRateLimit)
      .with(MultiPathApp);

    server = alepha.inject(ServerProvider);
    await alepha.start();

    // Both paths should have max: 5
    const v1Response = await fetch(`${server.hostname}/api/v1/data`);
    expect(v1Response.status).toBe(200);
    expect(v1Response.headers.get("x-ratelimit-limit")).toBe("5");

    const v2Response = await fetch(`${server.hostname}/api/v2/data`);
    expect(v2Response.status).toBe(200);
    expect(v2Response.headers.get("x-ratelimit-limit")).toBe("5");
  });
});
