import { Alepha } from "alepha";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { afterEach, describe, it } from "vitest";

import {
  $cors,
  AlephaServerCors,
  corsOptions,
  type ServerCorsProviderOptions,
} from "../index.ts";

// A simple test action to hit
class TestApp {
  hello = $action({ path: "/hello", method: "POST", handler: () => "world" });
  ping = $action({ path: "/ping", method: "GET", handler: () => "pong" });

  /**
   * A route whose own `$cors` allow-list is NARROWER than the global one.
   * The preflight and the request must agree about it.
   */
  scoped = $action({
    method: "POST",
    path: "/scoped",
    use: [$cors({ origin: "https://scoped.example.com", credentials: true })],
    handler: () => "scoped",
  });

  /**
   * An action with its own `$cors`, called through `run()` by a route that
   * declares none. The inner allow-list governs the inner action's own HTTP
   * route, never the response of whoever calls it in process.
   */
  narrowInner = $action({
    method: "GET",
    path: "/narrow-inner",
    use: [$cors({ origin: "https://inner.example.com" })],
    handler: () => "inner",
  });

  callsNarrow = $action({
    method: "GET",
    path: "/calls-narrow",
    handler: async () => `outer:${await this.narrowInner.run()}`,
  });

  wideInner = $action({
    method: "GET",
    path: "/wide-inner",
    use: [$cors({ origin: "https://other.example.com", credentials: true })],
    handler: () => "inner",
  });

  callsWide = $action({
    method: "GET",
    path: "/calls-wide",
    handler: async () => `outer:${await this.wideInner.run()}`,
  });
}

describe("ServerCorsProvider", () => {
  let alepha: Alepha;
  let server: ServerProvider;

  const setupServer = async (options?: Partial<ServerCorsProviderOptions>) => {
    alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaServerCors)
      .with(TestApp);

    if (options) {
      alepha.store.mut(corsOptions, (old) => ({
        ...old,
        ...options,
      }));
    }

    server = alepha.inject(ServerProvider);

    await alepha.start();
  };

  afterEach(async () => {
    if (alepha) {
      await alepha.stop();
    }
  });

  it("should return correct CORS headers for a simple request from an allowed origin", async ({
    expect,
  }) => {
    await setupServer({
      origin: "https://allowed.example.com",
      credentials: true,
    });

    const response = await fetch(`${server.hostname}/api/hello`, {
      method: "POST",
      headers: {
        Origin: "https://allowed.example.com",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://allowed.example.com",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
  });

  it("should handle wildcard origin correctly", async ({ expect }) => {
    await setupServer({
      origin: "*",
    });

    const response = await fetch(`${server.hostname}/api/hello`, {
      method: "POST",
      headers: {
        origin: "https://any.origin.com",
      },
    });

    expect(response.status).toBe(200);
    // The wildcard is answered by reflecting the request's origin, never `*`.
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://any.origin.com",
    );
  });

  it("should handle preflight OPTIONS request correctly", async ({
    expect,
  }) => {
    await setupServer({
      origin: "https://preflight.example.com",
      methods: ["GET", "POST", "OPTIONS"],
      headers: ["Content-Type", "X-Custom-Header"],
      maxAge: 86400,
    });

    const response = await fetch(`${server.hostname}/api/hello`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://preflight.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "X-Custom-Header",
      },
    });

    expect(response.status).toBe(204); // Preflight should return 204 No Content
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://preflight.example.com",
    );
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET, POST, OPTIONS",
    );
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "Content-Type, X-Custom-Header",
    );
    expect(response.headers.get("access-control-max-age")).toBe("86400");
  });

  it("should answer the preflight of a GET route", async ({ expect }) => {
    // A cross-origin GET carrying Authorization (in the default allowed
    // headers) IS preflighted by the browser. Without an OPTIONS twin the
    // preflight 404s and the browser blocks the real request.
    await setupServer({ origin: "https://preflight.example.com" });

    const response = await fetch(`${server.hostname}/api/ping`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://preflight.example.com",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://preflight.example.com",
    );
  });

  it("should set Vary: Origin when reflecting the request origin", async ({
    expect,
  }) => {
    await setupServer({ origin: "https://allowed.example.com" });

    const response = await fetch(`${server.hostname}/api/hello`, {
      method: "POST",
      headers: { Origin: "https://allowed.example.com" },
    });

    // Without it a shared cache can hand origin A's response to origin B.
    expect(response.headers.get("vary")).toContain("Origin");
  });

  it("should refuse credentials when origin is the wildcard", async ({
    expect,
  }) => {
    await setupServer({ origin: "*", credentials: true });

    const response = await fetch(`${server.hostname}/api/hello`, {
      method: "POST",
      headers: { Origin: "https://evil.example.com" },
    });

    // Reflecting an arbitrary origin AND allowing credentials lets any site
    // read authenticated responses. The combination must not be honoured.
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("should handle an array of allowed origins", async ({ expect }) => {
    const allowedOrigins = [
      "https://app1.example.com",
      "https://app2.example.com",
    ];
    await setupServer({
      origin: allowedOrigins.join(","),
    });

    // First allowed origin
    const res1 = await fetch(`${server.hostname}/api/hello`, {
      method: "POST",
      headers: { Origin: allowedOrigins[0] },
    });
    expect(res1.headers.get("access-control-allow-origin")).toBe(
      allowedOrigins[0],
    );

    // Second allowed origin
    const res2 = await fetch(`${server.hostname}/api/hello`, {
      method: "POST",
      headers: { Origin: allowedOrigins[1] },
    });
    expect(res2.headers.get("access-control-allow-origin")).toBe(
      allowedOrigins[1],
    );

    // Disallowed origin
    const res3 = await fetch(`${server.hostname}/api/hello`, {
      method: "POST",
      headers: { Origin: "https://disallowed.com" },
    });
    expect(res3.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("should not send credentials header with default config", async ({
    expect,
  }) => {
    await setupServer();

    const response = await fetch(`${server.hostname}/api/hello`, {
      method: "POST",
      headers: {
        Origin: "https://any.origin.com",
      },
    });

    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("should not return CORS headers if Origin header is not present", async ({
    expect,
  }) => {
    await setupServer();

    const response = await fetch(`${server.hostname}/api/hello`, {
      method: "POST",
    });

    // The route answered and the provider ran on it: only the grant is absent.
    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toContain("Origin");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("should send neither Allow-Origin nor Allow-Credentials to a rejected origin", async ({
    expect,
  }) => {
    await setupServer({
      origin: "https://allowed.example.com",
      credentials: true,
    });

    const response = await fetch(`${server.hostname}/api/hello`, {
      method: "POST",
      headers: { Origin: "https://evil.example.com" },
    });

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    // The browser blocks on the missing Allow-Origin either way, but a
    // refused origin must not be told its credentials are welcome.
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("a per-action $cors allow-list overrides the global one on the request", async ({
    expect,
  }) => {
    await setupServer({ origin: "https://global.example.com" });

    // Allowed globally, refused by the action's own list.
    const refused = await fetch(`${server.hostname}/api/scoped`, {
      method: "POST",
      headers: { Origin: "https://global.example.com" },
    });
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();

    // Refused globally, allowed by the action's own list.
    const accepted = await fetch(`${server.hostname}/api/scoped`, {
      method: "POST",
      headers: { Origin: "https://scoped.example.com" },
    });
    expect(accepted.headers.get("access-control-allow-origin")).toBe(
      "https://scoped.example.com",
    );
    expect(accepted.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
  });

  it("a per-action $cors allow-list overrides the global one on the preflight", async ({
    expect,
  }) => {
    await setupServer({ origin: "https://global.example.com" });

    // The generated OPTIONS twin carries no middleware of its own, so before
    // the fix it answered from the global options and contradicted the
    // request it was preflighting.
    const refused = await fetch(`${server.hostname}/api/scoped`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://global.example.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(refused.status).toBe(204);
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();

    const accepted = await fetch(`${server.hostname}/api/scoped`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://scoped.example.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(accepted.status).toBe(204);
    expect(accepted.headers.get("access-control-allow-origin")).toBe(
      "https://scoped.example.com",
    );
  });

  describe("an action with $cors called through run()", () => {
    it("does not remove the grant the outer route is entitled to", async ({
      expect,
    }) => {
      await setupServer({
        origin: "https://global.example.com",
        credentials: true,
      });

      const response = await fetch(`${server.hostname}/api/calls-narrow`, {
        headers: { Origin: "https://global.example.com" },
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("outer:inner");
      expect(response.headers.get("access-control-allow-origin")).toBe(
        "https://global.example.com",
      );
      expect(response.headers.get("access-control-allow-credentials")).toBe(
        "true",
      );
    });

    it("does not grant the outer response an origin the outer route refuses", async ({
      expect,
    }) => {
      await setupServer({ origin: "https://global.example.com" });

      const response = await fetch(`${server.hostname}/api/calls-wide`, {
        headers: { Origin: "https://other.example.com" },
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("outer:inner");
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(
        response.headers.get("access-control-allow-credentials"),
      ).toBeNull();
    });

    it("runs outside any HTTP request", async ({ expect }) => {
      await setupServer();

      expect(await alepha.inject(TestApp).narrowInner.run()).toBe("inner");
    });
  });
});
