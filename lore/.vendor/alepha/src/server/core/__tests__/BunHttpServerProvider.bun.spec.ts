import { afterEach, describe, expect, it } from "bun:test";

import { $hook, Alepha, z } from "alepha";

import { $action, $route, AlephaServer, ServerProvider } from "../index.ts";

// -------------------------------------------------------------------------------------------------------------------

describe("BunHttpServerProvider", () => {
  let alepha: Alepha;

  afterEach(async () => {
    await alepha?.stop().catch(() => {});
  });

  it("should start and stop cleanly", async () => {
    alepha = Alepha.create({ env: { NODE_ENV: "test" } });
    alepha.with(AlephaServer);
    await alepha.start();

    const server = alepha.inject(ServerProvider);
    expect(server.hostname).toContain("http://");

    await alepha.stop();
  });

  it("should handle $route requests", async () => {
    class App {
      hello = $route({
        path: "/hello",
        handler: () => "OK",
      });
    }

    alepha = Alepha.create({ env: { NODE_ENV: "test" } });
    await alepha.with(App).start();

    const server = alepha.inject(ServerProvider);
    const response = await fetch(`${server.hostname}/hello`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
  });

  it("should handle $action GET with JSON response", async () => {
    class App {
      hello = $action({
        method: "GET",
        path: "/hello",
        schema: {
          response: z.object({ message: z.text() }),
        },
        handler: async () => {
          return { message: "Hello from Bun!" };
        },
      });
    }

    alepha = Alepha.create({ env: { NODE_ENV: "test" } });
    await alepha.with(App).start();

    const server = alepha.inject(ServerProvider);
    // $action routes are prefixed with /api by default
    const response = await fetch(`${server.hostname}/api/hello`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ message: "Hello from Bun!" });
  });

  it("should return 404 for unknown routes", async () => {
    alepha = Alepha.create({ env: { NODE_ENV: "test" } });
    alepha.with(AlephaServer);
    await alepha.start();

    const server = alepha.inject(ServerProvider);
    const response = await fetch(`${server.hostname}/not-found`);

    expect(response.status).toBe(404);
  });

  it("should handle $action POST with JSON body", async () => {
    class App {
      echo = $action({
        method: "POST",
        path: "/echo",
        schema: {
          body: z.object({ input: z.text() }),
          response: z.object({ output: z.text() }),
        },
        handler: async ({ body }) => {
          return { output: body.input };
        },
      });
    }

    alepha = Alepha.create({ env: { NODE_ENV: "test" } });
    await alepha.with(App).start();

    const server = alepha.inject(ServerProvider);
    const response = await fetch(`${server.hostname}/api/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "test" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ output: "test" });
  });

  it("should use random port in test mode", async () => {
    alepha = Alepha.create({
      env: { NODE_ENV: "test", SERVER_PORT: 3000 },
    });
    alepha.with(AlephaServer);
    await alepha.start();

    const server = alepha.inject(ServerProvider);
    // Should pick a random port, not 3000
    expect(server.hostname).not.toContain(":3000");
  });

  it("should handle path params", async () => {
    class App {
      getUser = $action({
        method: "GET",
        path: "/users/:id",
        schema: {
          params: z.object({ id: z.text() }),
          response: z.object({ id: z.text() }),
        },
        handler: async ({ params }) => {
          return { id: params.id };
        },
      });
    }

    alepha = Alepha.create({ env: { NODE_ENV: "test" } });
    await alepha.with(App).start();

    const server = alepha.inject(ServerProvider);
    const response = await fetch(`${server.hostname}/api/users/42`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ id: "42" });
  });

  /**
   * The Bun half of `ServerProvider-binaryBody.spec.ts`: Bun writes through
   * `handleWebRequest`, not `handleNodeRequest`, so the Node round-trips say
   * nothing about it. A non-Buffer binary body used to go out as `{}` (an
   * `ArrayBuffer`) or as a JSON object of indices (a `Uint8Array`).
   */
  describe("binary bodies", () => {
    class BinaryApp {
      arrayBuffer = $route({
        path: "/array-buffer",
        handler: ({ reply }) => {
          reply.body = new TextEncoder().encode("hello").buffer;
        },
      });

      uint8Array = $route({
        path: "/uint8-array",
        handler: ({ reply }) => {
          reply.body = new TextEncoder().encode("hello");
        },
      });

      subarray = $route({
        path: "/subarray",
        handler: ({ reply }) => {
          reply.body = new TextEncoder().encode("[hello]").subarray(1, 6);
        },
      });

      dataView = $route({
        path: "/data-view",
        handler: ({ reply }) => {
          reply.body = new DataView(
            new TextEncoder().encode("[hello]").buffer,
            1,
            5,
          );
        },
      });

      hookSubarray = $route({
        path: "/hook-subarray",
        handler: () => "replaced by the hook",
      });

      /**
       * Sets the body after `serializeResponse` ran, so it reaches the
       * provider as it is. See the Node spec for why the type changes too.
       */
      onSend = $hook({
        on: "server:onSend",
        handler: ({ request }) => {
          if (request.url.pathname === "/hook-subarray") {
            request.reply.headers["content-type"] = "application/octet-stream";
            request.reply.body = new TextEncoder()
              .encode("[hello]")
              .subarray(1, 6);
          }
        },
      });
    }

    for (const path of ["/array-buffer", "/uint8-array"]) {
      it(`should send the bytes of ${path}, as application/octet-stream`, async () => {
        alepha = Alepha.create({ env: { NODE_ENV: "test" } });
        await alepha.with(BinaryApp).start();

        const server = alepha.inject(ServerProvider);
        const response = await fetch(`${server.hostname}${path}`);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("hello");
        expect(response.headers.get("content-type")).toBe(
          "application/octet-stream",
        );
      });
    }

    for (const path of ["/subarray", "/data-view", "/hook-subarray"]) {
      it(`should send only the viewed bytes of ${path}`, async () => {
        alepha = Alepha.create({ env: { NODE_ENV: "test" } });
        await alepha.with(BinaryApp).start();

        const server = alepha.inject(ServerProvider);
        const response = await fetch(`${server.hostname}${path}`);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("hello");
      });
    }
  });
});
