import { Alepha } from "alepha";
import { afterEach, describe, it } from "vitest";

import { $route } from "../index.ts";
import { NodeHttpServerProvider } from "../providers/NodeHttpServerProvider.ts";

describe("NodeHttpServerProvider", () => {
  describe("PORT alias", () => {
    /**
     * Every case pins SERVER_PORT and PORT explicitly, `undefined` included:
     * `Alepha.create()` merges `process.env`, so a runner that happens to
     * export either one would otherwise decide the outcome. NODE_ENV is
     * development so that no port is ever bound: `hostname` reports the
     * resolved port before the server listens.
     */
    const hostname = (env: { SERVER_PORT?: number; PORT?: number }) =>
      Alepha.create({ env: { NODE_ENV: "development", ...env } }).inject(
        NodeHttpServerProvider,
      ).hostname;

    it("reads PORT when SERVER_PORT is not set", ({ expect }) => {
      expect(hostname({ SERVER_PORT: undefined, PORT: 4002 })).toBe(
        "http://localhost:4002",
      );
    });

    it("ignores PORT when SERVER_PORT is set", ({ expect }) => {
      expect(hostname({ SERVER_PORT: 4001, PORT: 4002 })).toBe(
        "http://localhost:4001",
      );
    });

    it("keeps the 3000 default when neither is set", ({ expect }) => {
      expect(hostname({ SERVER_PORT: undefined, PORT: undefined })).toBe(
        "http://localhost:3000",
      );
    });

    it("listens on PORT when SERVER_PORT is not set", async ({ expect }) => {
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

    /**
     * An app with a request that answers after `delay`, or never when there
     * is none, and a promise resolved once that request reached its handler.
     */
    const withPendingRequest = async (
      env: Record<string, string | number>,
      delay?: number,
    ) => {
      let arrived!: () => void;
      const arriving = new Promise<void>((resolve) => {
        arrived = resolve;
      });

      class App {
        slow = $route({
          path: "/slow",
          handler: async ({ signal }) => {
            arrived();
            await new Promise<void>((resolve) => {
              if (delay !== undefined) {
                setTimeout(resolve, delay);
              }
              signal.addEventListener("abort", () => resolve(), {
                once: true,
              });
            });
            return "done";
          },
        });
      }

      alepha = Alepha.create({ env: { SERVER_PORT: 0, ...env } }).with(App);
      alepha.with(NodeHttpServerProvider);
      await alepha.start();
      server = alepha.inject(NodeHttpServerProvider);

      // `connection: close`: an idle keep-alive socket would hold a
      // graceful stop until the client let go of it.
      const pending = fetch(`${server.hostname}/slow`, {
        headers: { connection: "close" },
      })
        .then((response) => response.text())
        .catch(() => "broken");
      await arriving;
      // In an object: an async function returning the promise would wait for it.
      return { pending };
    };

    it("dev mode: destroys connections immediately on close", async ({
      expect,
    }) => {
      const { pending } = await withPendingRequest({ NODE_ENV: "development" });

      // The request never answers: a stop that waited for it would not
      // return.
      await alepha.stop();

      expect(await pending).toBe("broken");
      expect(server.getConnectionsCount()).toBe(0);
    });

    it("production mode: lets a request in flight finish, then closes", async ({
      expect,
    }) => {
      const { pending } = await withPendingRequest(
        { NODE_ENV: "production", APP_SECRET: "test-secret" },
        100,
      );
      server.options.shutdownTimeout = 5000;

      await alepha.stop();

      // Destroying the sockets at once, as development does, would have
      // broken it.
      expect(await pending).toBe("done");
      expect(server.getConnectionsCount()).toBe(0);
    });

    it("production mode: forces close after timeout", async ({ expect }) => {
      const { pending } = await withPendingRequest({
        NODE_ENV: "production",
        APP_SECRET: "test-secret",
      });
      server.options.shutdownTimeout = 50;

      // The request never answers, so only the timeout can end the stop.
      await alepha.stop();

      expect(await pending).toBe("broken");
      expect(server.getConnectionsCount()).toBe(0);
    });

    it("connections are tracked and cleared", async ({ expect }) => {
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

    it("rejects new requests during shutdown", async ({ expect }) => {
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
