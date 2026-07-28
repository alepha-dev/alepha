import { Alepha } from "alepha";
import { AlephaCache } from "alepha/cache";
import {
  $action,
  AlephaServer,
  ServerProvider,
  type ServerRequest,
} from "alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  $rateLimit,
  AlephaServerRateLimit,
  type RateLimitRequest,
  ServerRateLimitProvider,
} from "../index.ts";

/**
 * `keyGenerator`, `skipFailedRequests` and `skipSuccessfulRequests` are part of
 * the public `RateLimitOptions` surface. They were declared, merged into the
 * resolved options and then never read — silent no-ops on a security control.
 */
describe("RateLimitOptions — keyGenerator", () => {
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

  const request = (ip: string): ServerRequest => ({ ip, headers: {} }) as any;

  it("uses the custom key generator instead of the client ip", async () => {
    const options = {
      max: 2,
      windowMs: 60_000,
      keyGenerator: () => "tenant:acme",
    };

    // Three DIFFERENT ips. Under the default ip key they would never collide;
    // the custom generator collapses them onto one counter.
    const a = await provider.checkLimit(request("10.0.0.1"), options);
    const b = await provider.checkLimit(request("10.0.0.2"), options);
    const c = await provider.checkLimit(request("10.0.0.3"), options);

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(c.allowed).toBe(false);
  });

  it("receives the request so the key can depend on it", async () => {
    const seen: Array<string | undefined> = [];
    const options = {
      max: 10,
      windowMs: 60_000,
      keyGenerator: (req: RateLimitRequest) => {
        seen.push(req.ip);
        return `ip:${req.ip}:scoped`;
      },
    };

    await provider.checkLimit(request("10.0.0.9"), options);

    expect(seen).toEqual(["10.0.0.9"]);
  });

  it("falls back to the ip key when no generator is given", async () => {
    const options = { max: 1, windowMs: 60_000 };

    const a = await provider.checkLimit(request("10.1.0.1"), options);
    const b = await provider.checkLimit(request("10.1.0.2"), options);

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });
});

describe("RateLimitOptions — skipSuccessfulRequests / skipFailedRequests", () => {
  const startApp = async (rateLimit: {
    max: number;
    windowMs: number;
    skipSuccessfulRequests?: boolean;
    skipFailedRequests?: boolean;
  }) => {
    class TestApp {
      ok = $action({
        path: "/ok",
        use: [$rateLimit(rateLimit)],
        handler: () => "ok",
      });

      boom = $action({
        path: "/boom",
        use: [$rateLimit(rateLimit)],
        handler: () => {
          throw new Error("boom");
        },
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaCache)
      .with(AlephaServerRateLimit)
      .with(TestApp);
    await alepha.start();
    return { alepha, hostname: alepha.inject(ServerProvider).hostname };
  };

  it("does not count successful responses when skipSuccessfulRequests is set", async () => {
    const { alepha, hostname } = await startApp({
      max: 2,
      windowMs: 60_000,
      skipSuccessfulRequests: true,
    });

    // Ten successful calls against a limit of two. Every one refunds itself,
    // so the counter never reaches the ceiling.
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${hostname}/api/ok`);
      await res.arrayBuffer();
      expect(res.status).toBe(200);
    }

    await alepha.stop();
  });

  it("still counts failed responses when only skipSuccessfulRequests is set", async () => {
    const { alepha, hostname } = await startApp({
      max: 2,
      windowMs: 60_000,
      skipSuccessfulRequests: true,
    });

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${hostname}/api/boom`);
      await res.arrayBuffer();
      statuses.push(res.status);
    }

    // 500, 500, then the limit bites.
    expect(statuses[0]).toBe(500);
    expect(statuses[1]).toBe(500);
    expect(statuses[3]).toBe(429);

    await alepha.stop();
  });

  it("does not count failed responses when skipFailedRequests is set", async () => {
    const { alepha, hostname } = await startApp({
      max: 2,
      windowMs: 60_000,
      skipFailedRequests: true,
    });

    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${hostname}/api/boom`);
      await res.arrayBuffer();
      expect(res.status).toBe(500);
    }

    await alepha.stop();
  });

  it("counts everything when neither skip option is set", async () => {
    const { alepha, hostname } = await startApp({ max: 2, windowMs: 60_000 });

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${hostname}/api/ok`);
      await res.arrayBuffer();
      statuses.push(res.status);
    }

    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(200);
    expect(statuses[2]).toBe(429);

    await alepha.stop();
  });
});
