import { Alepha } from "alepha";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { afterEach, describe, it } from "vitest";

import {
  $cors,
  AlephaServerCors,
  CAPACITOR_ORIGINS,
  corsOptions,
} from "../index.ts";

class NativeApi {
  notes = $action({
    method: "POST",
    handler: () => "notes",
  });

  /**
   * Narrowed to the native app on the route itself, under a global policy
   * that allows something else.
   */
  device = $action({
    method: "POST",
    path: "/device",
    use: [$cors({ origin: CAPACITOR_ORIGINS })],
    handler: () => "device",
  });
}

describe("CAPACITOR_ORIGINS", () => {
  let alepha: Alepha;

  const start = async (origin: string) => {
    alepha = Alepha.create()
      .with(AlephaServer)
      .with(AlephaServerCors)
      .with(NativeApi);
    alepha.store.mut(corsOptions, (options) => ({ ...options, origin }));
    await alepha.start();
    return alepha.inject(ServerProvider).hostname;
  };

  const preflight = (host: string, path: string, origin: string) =>
    fetch(`${host}${path}`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization",
      },
    });

  const call = (host: string, path: string, origin: string) =>
    fetch(`${host}${path}`, {
      method: "POST",
      headers: { Origin: origin, Authorization: "Bearer token" },
    });

  afterEach(async () => {
    await alepha?.stop();
  });

  it("names exactly the iOS and Android WebView origins", ({ expect }) => {
    expect(CAPACITOR_ORIGINS.split(",")).toEqual([
      "capacitor://localhost",
      "https://localhost",
    ]);
  });

  for (const origin of ["capacitor://localhost", "https://localhost"]) {
    it(`grants ${origin} on the preflight and the request, Bearer and no credentials`, async ({
      expect,
    }) => {
      const host = await start(CAPACITOR_ORIGINS);

      for (const response of [
        await preflight(host, "/api/notes", origin),
        await call(host, "/api/notes", origin),
      ]) {
        expect(response.headers.get("access-control-allow-origin")).toBe(
          origin,
        );
        expect(response.headers.get("vary")).toMatch(/Origin/);
        expect(
          response.headers.get("access-control-allow-headers")?.toLowerCase(),
        ).toContain("authorization");
        expect(
          response.headers.get("access-control-allow-credentials"),
        ).toBeNull();
      }
    });
  }

  it("refuses any other origin, the legacy http://localhost included", async ({
    expect,
  }) => {
    const host = await start(CAPACITOR_ORIGINS);

    for (const origin of ["http://localhost", "https://evil.example"]) {
      const options = await preflight(host, "/api/notes", origin);
      const post = await call(host, "/api/notes", origin);
      expect(options.headers.get("access-control-allow-origin")).toBeNull();
      expect(post.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("works as a route's own $cors, which stays authoritative", async ({
    expect,
  }) => {
    // The global policy allows a website only; the route allows the app only.
    const host = await start("https://www.example.com");

    const app = await call(host, "/api/device", "capacitor://localhost");
    const site = await call(host, "/api/device", "https://www.example.com");

    expect(app.headers.get("access-control-allow-origin")).toBe(
      "capacitor://localhost",
    );
    expect(site.headers.get("access-control-allow-origin")).toBeNull();
  });
});
