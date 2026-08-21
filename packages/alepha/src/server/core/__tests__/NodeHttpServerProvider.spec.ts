import { Alepha } from "alepha";
import { afterEach, describe, expect, it, test } from "vitest";

import { NodeHttpServerProvider } from "../providers/NodeHttpServerProvider.ts";

describe("NodeHttpServerProvider", () => {
  describe("PORT alias", () => {
    /**
     * Every case pins SERVER_PORT and PORT explicitly, `undefined` included:
     * `Alepha.create()` merges `process.env`, so a runner that happens to
     * export either one would otherwise decide the outcome. NODE_ENV is
     * development so that no port is ever bound — `hostname` reports the
     * resolved port before the server listens.
     */
    const hostname = (env: { SERVER_PORT?: number; PORT?: number }) =>
      Alepha.create({ env: { NODE_ENV: "development", ...env } }).inject(
        NodeHttpServerProvider,
      ).hostname;

    it("reads PORT when SERVER_PORT is not set", () => {
      expect(hostname({ SERVER_PORT: undefined, PORT: 4002 })).toBe(
        "http://localhost:4002",
      );
    });

    it("ignores PORT when SERVER_PORT is set", () => {
      expect(hostname({ SERVER_PORT: 4001, PORT: 4002 })).toBe(
        "http://localhost:4001",
      );
    });

    it("keeps the 3000 default when neither is set", () => {
      expect(hostname({ SERVER_PORT: undefined, PORT: undefined })).toBe(
        "http://localhost:3000",
      );
    });

    it("listens on PORT when SERVER_PORT is not set", async () => {
      const alepha = Alepha.create({
        env: { NODE_ENV: "development", SERVER_PORT: undefined, PORT: 0 },
      });
      alepha.with(NodeHttpServerProvider);

      await alepha.start();
      const server = alepha.inject(NodeHttpServerProvider);

      try {
        // PORT 0 asks the OS for a free one: had the alias been ignored, the
        // schema default would have bound 3000 instead.
        expect(server.hostname).toMatch(/:\d+$/);
        expect(server.hostname).not.toContain(":3000");
        const res = await fetch(`${server.hostname}/`);
        await res.body?.cancel();
      } finally {
        await alepha.stop();
      }
    });
  });

  describe("graceful shutdown", () => {
    let alepha: Alepha;
    let server: NodeHttpServerProvider;

    afterEach(async () => {
      await alepha?.stop().catch(() => {});
    });

    test("dev mode: destroys connections immediately on close", async () => {
      alepha = Alepha.create({
        env: { NODE_ENV: "development", SERVER_PORT: 0 },
      });
      alepha.with(NodeHttpServerProvider);

      await alepha.start();
      server = alepha.inject(NodeHttpServerProvider);

      // Make a request to establish connection
      await fetch(`${server.hostname}/`);

      const startTime = Date.now();
      await alepha.stop();
      const elapsed = Date.now() - startTime;

      // Should close instantly (under 100ms)
      expect(elapsed).toBeLessThan(100);
      expect(server.getConnectionsCount()).toBe(0);
    });

    test("production mode: waits for connections then closes", async () => {
      alepha = Alepha.create({
        env: {
          NODE_ENV: "production",
          SERVER_PORT: 0,
          APP_SECRET: "test-secret",
        },
      });
      alepha.with(NodeHttpServerProvider);

      await alepha.start();
      server = alepha.inject(NodeHttpServerProvider);
      server.options.shutdownTimeout = 500;

      // Make a request to establish keep-alive connection
      await fetch(`${server.hostname}/`);

      const startTime = Date.now();
      await alepha.stop();
      const elapsed = Date.now() - startTime;

      // In production, should not be instant (waits for graceful close or timeout)
      // But should complete within timeout
      expect(elapsed).toBeLessThan(server.options.shutdownTimeout + 100);
      expect(server.getConnectionsCount()).toBe(0);
    });

    test("production mode: forces close after timeout", async () => {
      alepha = Alepha.create({
        env: {
          NODE_ENV: "production",
          SERVER_PORT: 0,
          APP_SECRET: "test-secret",
        },
      });
      alepha.with(NodeHttpServerProvider);

      await alepha.start();
      server = alepha.inject(NodeHttpServerProvider);
      server.options.shutdownTimeout = 50;

      // Make a request to establish connection
      await fetch(`${server.hostname}/`);

      const startTime = Date.now();
      await alepha.stop();
      const elapsed = Date.now() - startTime;

      // Should close around timeout
      expect(elapsed).toBeLessThan(200);
      expect(server.getConnectionsCount()).toBe(0);
    });

    test("connections are tracked and cleared", async () => {
      alepha = Alepha.create({
        env: { NODE_ENV: "development", SERVER_PORT: 0 },
      });
      alepha.with(NodeHttpServerProvider);

      await alepha.start();
      server = alepha.inject(NodeHttpServerProvider);

      // Make multiple requests
      await fetch(`${server.hostname}/`);
      await fetch(`${server.hostname}/`);

      await alepha.stop();

      // All connections cleared after stop
      expect(server.getConnectionsCount()).toBe(0);
    });

    test("rejects new requests during shutdown", async () => {
      alepha = Alepha.create({
        env: {
          NODE_ENV: "production",
          SERVER_PORT: 0,
          APP_SECRET: "test-secret",
        },
      });
      alepha.with(NodeHttpServerProvider);

      await alepha.start();
      server = alepha.inject(NodeHttpServerProvider);
      server.options.shutdownTimeout = 500;

      // Establish a connection to keep server busy
      await fetch(`${server.hostname}/`);

      // Start shutdown (don't await yet)
      const stopPromise = alepha.stop();

      // Give server.close() time to be called
      await new Promise((r) => setTimeout(r, 10));

      // New request should fail (server no longer accepting connections)
      let error: Error | null = null;
      try {
        await fetch(`${server.hostname}/`, {
          signal: AbortSignal.timeout(100),
        });
      } catch (e) {
        error = e as Error;
      }

      // Should get a connection error (ECONNREFUSED or similar)
      expect(error).not.toBeNull();

      // Wait for shutdown to complete
      await stopPromise;
    });
  });
});
