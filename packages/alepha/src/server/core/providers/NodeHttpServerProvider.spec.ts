import { Alepha } from "alepha";
import { afterEach, describe, expect, test } from "vitest";
import { NodeHttpServerProvider } from "./NodeHttpServerProvider.ts";

describe("NodeHttpServerProvider", () => {
  describe("graceful shutdown", () => {
    let alepha: Alepha;
    let server: NodeHttpServerProvider;

    afterEach(async () => {
      await alepha?.stop().catch(() => {});
    });

    test("dev mode: destroys connections immediately on close", async () => {
      alepha = Alepha.create({ env: { NODE_ENV: "development" } });
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
      alepha = Alepha.create({ env: { NODE_ENV: "production" } });
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
      alepha = Alepha.create({ env: { NODE_ENV: "production" } });
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
      alepha = Alepha.create({ env: { NODE_ENV: "development" } });
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
      alepha = Alepha.create({ env: { NODE_ENV: "production" } });
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
