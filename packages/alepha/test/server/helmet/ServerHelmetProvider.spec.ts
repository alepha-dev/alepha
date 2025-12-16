import { Alepha } from "alepha";
import { $action, ServerProvider } from "alepha/server";
import {
  AlephaServerHelmet,
  type HelmetOptions,
  helmetOptions,
} from "alepha/server/helmet";
import { describe, expect, test } from "vitest";

class TestApp {
  ping = $action({ handler: () => "pong" });
}

describe("ServerHelmetProvider", () => {
  const setupServer = async (options?: HelmetOptions) => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0 },
    })
      .with(AlephaServerHelmet)
      .with(TestApp);

    if (options) {
      alepha.store.mut(helmetOptions, (old) => ({
        ...old,
        ...options,
      }));
    }

    await alepha.start();
    const server = alepha.inject(ServerProvider);

    return {
      hostname: server.hostname,
      stop: () => alepha.stop(),
    };
  };

  test("should add default security headers to the response", async () => {
    const { hostname, stop } = await setupServer({
      isSecure: true, // fake secure context
    });

    const response = await fetch(`${hostname}/api/ping`);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response.headers.get("strict-transport-security")).toContain(
      "max-age=15552000",
    );

    await stop();
  });

  test("should allow disabling a header by setting its option to undefined", async () => {
    const { hostname, stop } = await setupServer({
      xFrameOptions: undefined,
    });

    const response = await fetch(`${hostname}/api/ping`);

    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    await stop();
  });

  test("should allow configuring HSTS", async () => {
    const { hostname, stop } = await setupServer({
      isSecure: true, // fake secure context
      strictTransportSecurity: { maxAge: 31536000, preload: true },
    });

    const response = await fetch(`${hostname}/api/ping`);

    const hstsHeader = response.headers.get("strict-transport-security");
    expect(hstsHeader).toContain("max-age=31536000");
    expect(hstsHeader).toContain("preload");

    await stop();
  });

  test("should apply a Content Security Policy when configured", async () => {
    const { hostname, stop } = await setupServer({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "https://trusted.cdn.com"],
        },
      },
    });

    const response = await fetch(`${hostname}/api/ping`);

    const cspHeader = response.headers.get("content-security-policy");
    expect(cspHeader).toBe(
      "default-src 'self'; script-src 'self' https://trusted.cdn.com",
    );

    await stop();
  });
});
