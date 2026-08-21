import { Alepha } from "alepha";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { afterEach, describe, expect, test } from "vitest";

import {
  AlephaServerCors,
  corsOptions,
  type ServerCorsProviderOptions,
} from "../index.ts";

// A simple test action to hit
class TestApp {
  hello = $action({
    method: "POST",
    handler: () => "world",
  });
  ping = $action({
    handler: () => "pong",
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

  test("should return correct CORS headers for a simple request from an allowed origin", async () => {
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

  test("should handle wildcard origin correctly", async () => {
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
    // Note: Wildcard returns the specific origin, not '*' when credentials are not sent by browser
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://any.origin.com",
    );
  });

  test("should handle preflight OPTIONS request correctly", async () => {
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

  test("should answer the preflight of a GET route", async () => {
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

  test("should set Vary: Origin when reflecting the request origin", async () => {
    await setupServer({ origin: "https://allowed.example.com" });

    const response = await fetch(`${server.hostname}/api/hello`, {
      method: "POST",
      headers: { Origin: "https://allowed.example.com" },
    });

    // Without it a shared cache can hand origin A's response to origin B.
    expect(response.headers.get("vary")).toContain("Origin");
  });

  test("should refuse credentials when origin is the wildcard", async () => {
    await setupServer({ origin: "*", credentials: true });

    const response = await fetch(`${server.hostname}/api/hello`, {
      method: "POST",
      headers: { Origin: "https://evil.example.com" },
    });

    // Reflecting an arbitrary origin AND allowing credentials lets any site
    // read authenticated responses. The combination must not be honoured.
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  test("should NOT return CORS headers for a request from a disallowed origin", async () => {
    await setupServer({
      origin: "https://allowed.example.com",
    });

    const response = await fetch(`${server.hostname}/api/hello`, {
      headers: {
        Origin: "https://disallowed.example.com",
      },
    });

    // The header should not be set because the origin is not in the allow list.
    // Some servers might omit it, others might return null. Checking for not-allowed is key.
    expect(response.headers.get("access-control-allow-origin")).not.toBe(
      "https://disallowed.example.com",
    );
  });

  test("should handle an array of allowed origins", async () => {
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

  test("should not send credentials header with default config", async () => {
    await setupServer();

    const response = await fetch(`${server.hostname}/api/hello`, {
      method: "POST",
      headers: {
        Origin: "https://any.origin.com",
      },
    });

    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  test("should not return CORS headers if Origin header is not present", async () => {
    await setupServer();

    const response = await fetch(`${server.hostname}/api/hello`); // No Origin header

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
