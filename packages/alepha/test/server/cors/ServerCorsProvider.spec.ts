import { Alepha } from "alepha";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import {
  $cors,
  AlephaServerCors,
  corsOptions,
  ServerCorsProvider,
  type ServerCorsProviderOptions,
} from "alepha/server/cors";
import { afterEach, describe, expect, test } from "vitest";

// A simple test action to hit
class TestApp {
  hello = $action({
    method: "POST",
    handler: () => "world",
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

  test("should not return CORS headers if Origin header is not present", async () => {
    await setupServer();

    const response = await fetch(`${server.hostname}/api/hello`); // No Origin header

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("$cors primitive", () => {
  let alepha: Alepha;
  let server: ServerProvider;

  afterEach(async () => {
    if (alepha) {
      await alepha.stop();
    }
  });

  test("should apply path-specific CORS config to matching routes", async () => {
    class AppWithCors {
      // Path-specific CORS for /api/v1/* routes
      apiCors = $cors({
        paths: ["/api/v1/*"],
        origin: "https://api.example.com",
        credentials: true,
      });

      // $action adds /api prefix, so path "/v1/data" becomes "/api/v1/data"
      apiAction = $action({
        path: "/v1/data",
        method: "POST",
        handler: () => "api",
      });

      // Path "/public/info" becomes "/api/public/info"
      publicAction = $action({
        path: "/public/info",
        method: "POST",
        handler: () => "public",
      });
    }

    alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaServerCors)
      .with(AppWithCors);

    // Set global CORS to different origin
    alepha.store.mut(corsOptions, (old) => ({
      ...old,
      origin: "https://global.example.com",
    }));

    server = alepha.inject(ServerProvider);
    await alepha.start();

    // API route should use path-specific CORS (path is /api/v1/data)
    const apiResponse = await fetch(`${server.hostname}/api/v1/data`, {
      method: "POST",
      headers: { Origin: "https://api.example.com" },
    });
    expect(apiResponse.headers.get("access-control-allow-origin")).toBe(
      "https://api.example.com",
    );

    // Public route should use global CORS (api origin not allowed)
    const publicResponse = await fetch(`${server.hostname}/api/public/info`, {
      method: "POST",
      headers: { Origin: "https://api.example.com" },
    });
    expect(
      publicResponse.headers.get("access-control-allow-origin"),
    ).toBeNull();

    // Public route with global origin should work
    const publicGlobalResponse = await fetch(
      `${server.hostname}/api/public/info`,
      {
        method: "POST",
        headers: { Origin: "https://global.example.com" },
      },
    );
    expect(
      publicGlobalResponse.headers.get("access-control-allow-origin"),
    ).toBe("https://global.example.com");
  });

  test("should apply different CORS configs to different paths", async () => {
    class MultiCorsApp {
      // $action adds /api prefix, so patterns need /api/admin/* and /api/public/*
      adminCors = $cors({
        paths: ["/api/admin/*"],
        origin: "https://admin.example.com",
        methods: ["GET", "POST"],
      });

      publicCors = $cors({
        paths: ["/api/public/*"],
        origin: "*",
        methods: ["GET"],
      });

      adminAction = $action({
        path: "/admin/users",
        method: "POST",
        handler: () => "users",
      });

      publicAction = $action({
        path: "/public/status",
        method: "GET",
        handler: () => "ok",
      });
    }

    alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaServerCors)
      .with(MultiCorsApp);

    server = alepha.inject(ServerProvider);
    await alepha.start();

    // Admin route with admin origin (actual path is /api/admin/users)
    const adminResponse = await fetch(`${server.hostname}/api/admin/users`, {
      method: "POST",
      headers: { Origin: "https://admin.example.com" },
    });
    expect(adminResponse.headers.get("access-control-allow-origin")).toBe(
      "https://admin.example.com",
    );
    expect(adminResponse.headers.get("access-control-allow-methods")).toBe(
      "GET, POST",
    );

    // Public route with any origin (wildcard) (actual path is /api/public/status)
    const publicResponse = await fetch(`${server.hostname}/api/public/status`, {
      headers: { Origin: "https://any.example.com" },
    });
    expect(publicResponse.headers.get("access-control-allow-origin")).toBe(
      "https://any.example.com",
    );
    expect(publicResponse.headers.get("access-control-allow-methods")).toBe(
      "GET",
    );
  });

  test("should register CORS configs with provider", async () => {
    class RegistrationApp {
      cors1 = $cors({
        name: "api-cors",
        paths: ["/api/*"],
        origin: "https://api.example.com",
      });

      cors2 = $cors({
        name: "admin-cors",
        paths: ["/admin/*"],
        origin: "https://admin.example.com",
      });
    }

    alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaServerCors)
      .with(RegistrationApp);

    const corsProvider = alepha.inject(ServerCorsProvider);
    await alepha.start();

    expect(corsProvider.registeredConfigs).toHaveLength(2);
    expect(corsProvider.registeredConfigs[0].name).toBe("api-cors");
    expect(corsProvider.registeredConfigs[1].name).toBe("admin-cors");
  });

  test("should merge path-specific config with global defaults", async () => {
    class PartialConfigApp {
      // Only override origin, use defaults for methods/headers
      // $action creates route at /api/data, so use /api/* pattern
      apiCors = $cors({
        paths: ["/api/*"],
        origin: "https://api.example.com",
        // methods, headers, credentials should come from global defaults
      });

      // $action with path "/data" creates route at "/api/data"
      apiAction = $action({
        path: "/data",
        method: "POST",
        handler: () => "test",
      });
    }

    alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaServerCors)
      .with(PartialConfigApp);

    server = alepha.inject(ServerProvider);
    await alepha.start();

    const response = await fetch(`${server.hostname}/api/data`, {
      method: "POST",
      headers: { Origin: "https://api.example.com" },
    });

    // Path-specific origin
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://api.example.com",
    );
    // Default methods
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    // Default headers
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "Content-Type, Authorization",
    );
    // Default credentials
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
  });

  test("should apply maxAge to path-specific CORS", async () => {
    class MaxAgeApp {
      apiCors = $cors({
        paths: ["/api/*"],
        origin: "https://api.example.com",
        maxAge: 3600,
      });

      // $action with path "/data" creates route at "/api/data"
      apiAction = $action({
        path: "/data",
        method: "POST",
        handler: () => "test",
      });
    }

    alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaServerCors)
      .with(MaxAgeApp);

    server = alepha.inject(ServerProvider);
    await alepha.start();

    const response = await fetch(`${server.hostname}/api/data`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://api.example.com",
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(response.headers.get("access-control-max-age")).toBe("3600");
  });

  test("should handle multiple paths in single $cors primitive", async () => {
    class MultiPathApp {
      // $action creates routes at /api/v1/data and /api/v2/data
      apiCors = $cors({
        paths: ["/api/v1/*", "/api/v2/*"],
        origin: "https://api.example.com",
      });

      // Route created at /api/v1/data
      action1 = $action({
        path: "/v1/data",
        method: "POST",
        handler: () => "v1",
      });

      // Route created at /api/v2/data
      action2 = $action({
        path: "/v2/data",
        method: "POST",
        handler: () => "v2",
      });
    }

    alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaServerCors)
      .with(MultiPathApp);

    server = alepha.inject(ServerProvider);
    await alepha.start();

    // Both paths should have the same CORS config
    const v1Response = await fetch(`${server.hostname}/api/v1/data`, {
      method: "POST",
      headers: { Origin: "https://api.example.com" },
    });
    expect(v1Response.headers.get("access-control-allow-origin")).toBe(
      "https://api.example.com",
    );

    const v2Response = await fetch(`${server.hostname}/api/v2/data`, {
      method: "POST",
      headers: { Origin: "https://api.example.com" },
    });
    expect(v2Response.headers.get("access-control-allow-origin")).toBe(
      "https://api.example.com",
    );
  });
});
