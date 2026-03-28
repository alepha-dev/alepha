import { afterEach, describe, expect, it } from "bun:test";
import { Alepha, t } from "alepha";
import { $action, $route, AlephaServer, ServerProvider } from "../index.ts";

// -------------------------------------------------------------------------------------------------------------------

describe("BunHttpServerProvider", () => {
  let alepha: Alepha;

  afterEach(async () => {
    await alepha?.stop().catch(() => {});
  });

  it("should start and stop cleanly", async () => {
    alepha = Alepha.create({ env: { NODE_ENV: "development" } });
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

    alepha = Alepha.create({ env: { NODE_ENV: "development" } });
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
          response: t.object({ message: t.text() }),
        },
        handler: async () => {
          return { message: "Hello from Bun!" };
        },
      });
    }

    alepha = Alepha.create({ env: { NODE_ENV: "development" } });
    await alepha.with(App).start();

    const server = alepha.inject(ServerProvider);
    // $action routes are prefixed with /api by default
    const response = await fetch(`${server.hostname}/api/hello`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ message: "Hello from Bun!" });
  });

  it("should return 404 for unknown routes", async () => {
    alepha = Alepha.create({ env: { NODE_ENV: "development" } });
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
          body: t.object({ input: t.text() }),
          response: t.object({ output: t.text() }),
        },
        handler: async ({ body }) => {
          return { output: body.input };
        },
      });
    }

    alepha = Alepha.create({ env: { NODE_ENV: "development" } });
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
          params: t.object({ id: t.text() }),
          response: t.object({ id: t.text() }),
        },
        handler: async ({ params }) => {
          return { id: params.id };
        },
      });
    }

    alepha = Alepha.create({ env: { NODE_ENV: "development" } });
    await alepha.with(App).start();

    const server = alepha.inject(ServerProvider);
    const response = await fetch(`${server.hostname}/api/users/42`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ id: "42" });
  });
});
