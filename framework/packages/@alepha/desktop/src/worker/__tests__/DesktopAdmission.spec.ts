import { describe, it } from "vitest";

import { DesktopAdmission } from "../DesktopAdmission.ts";

const port = 50123;
const origin = `http://127.0.0.1:${port}`;
const capability = "ab".repeat(32);

const setup = () => {
  let clock = 0;
  const admission = new DesktopAdmission({
    capability,
    identifier: "dev.alepha.loom",
    now: () => clock,
  });
  const request = (
    path: string,
    init: RequestInit & { host?: string } = {},
  ) => {
    const headers = new Headers(init.headers);
    headers.set("host", init.host ?? `127.0.0.1:${port}`);
    return admission.admit(
      new Request(`${origin}${path}`, { ...init, headers }),
      port,
    );
  };
  const bootstrap = () =>
    request(`/__alepha_desktop/bootstrap?capability=${capability}`);
  const cookieOf = (response: Response | undefined) =>
    response!.headers.get("set-cookie")!.split(";")[0];
  return {
    admission,
    request,
    bootstrap,
    cookieOf,
    tick: (ms: number) => (clock += ms),
  };
};

describe("DesktopAdmission", () => {
  it("exchanges the capability once for an HttpOnly Strict host-only session cookie and a clean 303", ({
    expect,
  }) => {
    const { bootstrap } = setup();

    const response = bootstrap()!;

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(
      /^alepha_desktop_dev_alepha_loom=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\/$/,
    );
    expect(cookie).not.toContain(capability);
    expect(cookie).not.toMatch(/Domain|Secure/);

    expect(bootstrap()!.status).toBe(403);
  });

  it("refuses an expired, wrong, truncated or non-GET bootstrap", ({
    expect,
  }) => {
    const late = setup();
    late.tick(30_001);
    expect(late.bootstrap()!.status).toBe(403);

    const { request } = setup();
    expect(
      request(`/__alepha_desktop/bootstrap?capability=${"cd".repeat(32)}`)!
        .status,
    ).toBe(403);
    expect(
      request(`/__alepha_desktop/bootstrap?capability=${capability.slice(1)}`)!
        .status,
    ).toBe(403);
    expect(request("/__alepha_desktop/bootstrap")!.status).toBe(403);
    expect(
      request(`/__alepha_desktop/bootstrap?capability=${capability}`, {
        method: "POST",
      })!.status,
    ).toBe(403);
  });

  it("refuses every path without the session, static files, unknown routes, actions and OPTIONS alike", ({
    expect,
  }) => {
    const { request } = setup();
    for (const path of [
      "/",
      "/entry.X1.js",
      "/favicon.ico",
      "/no/such/page",
      "/api/actions/inc",
    ]) {
      expect(request(path)?.status).toBe(403);
    }
    expect(request("/", { method: "OPTIONS" })?.status).toBe(403);
    expect(request("/", { method: "POST" })?.status).toBe(403);
    expect(
      request("/ws", {
        headers: { upgrade: "websocket", connection: "Upgrade" },
      })?.status,
    ).toBe(403);
  });

  it("lets the session through on every path", ({ expect }) => {
    const { request, bootstrap, cookieOf } = setup();
    const cookie = cookieOf(bootstrap());
    for (const path of ["/", "/entry.X1.js", "/no/such/page"]) {
      expect(request(path, { headers: { cookie } })).toBeUndefined();
    }
    expect(
      request("/", { headers: { cookie: `theme=dark; ${cookie}; x=1` } }),
    ).toBeUndefined();
    expect(
      request("/", { method: "OPTIONS", headers: { cookie } }),
    ).toBeUndefined();
  });

  it("refuses a wrong, stale or another launch's session", ({ expect }) => {
    const first = setup();
    const stale = first.cookieOf(first.bootstrap());
    const second = setup();
    second.bootstrap();

    expect(second.request("/", { headers: { cookie: stale } })?.status).toBe(
      403,
    );
    expect(
      second.request("/", {
        headers: { cookie: `alepha_desktop_dev_alepha_loom=${capability}` },
      })?.status,
    ).toBe(403);
    expect(
      second.request("/", {
        headers: { cookie: "alepha_desktop_dev_alepha_loom=" },
      })?.status,
    ).toBe(403);
  });

  it("refuses a foreign Host, and never reads forwarded headers", ({
    expect,
  }) => {
    const { request, bootstrap, cookieOf } = setup();
    const cookie = cookieOf(bootstrap());
    for (const host of [
      "localhost:50123",
      "127.0.0.1:50124",
      "127.0.0.1",
      "evil.test",
      "[::1]:50123",
    ]) {
      expect(request("/", { host, headers: { cookie } })?.status).toBe(403);
    }
    expect(
      request("/", {
        host: "evil.test",
        headers: { cookie, "x-forwarded-host": `127.0.0.1:${port}` },
      })?.status,
    ).toBe(403);
  });

  it("refuses a valid cookie sent from another origin, null, or a hostile fetch site", ({
    expect,
  }) => {
    const { request, bootstrap, cookieOf } = setup();
    const cookie = cookieOf(bootstrap());
    for (const value of [
      "http://127.0.0.1:50999",
      "null",
      "http://localhost:50123",
      "https://127.0.0.1:50123",
    ]) {
      expect(request("/", { headers: { cookie, origin: value } })?.status).toBe(
        403,
      );
    }
    for (const site of ["same-site", "cross-site"]) {
      expect(
        request("/", { headers: { cookie, "sec-fetch-site": site } })?.status,
      ).toBe(403);
    }
    expect(
      request("/", {
        headers: { cookie, origin, "sec-fetch-site": "same-origin" },
      }),
    ).toBeUndefined();
    expect(
      request("/", { headers: { cookie, "sec-fetch-site": "none" } }),
    ).toBeUndefined();
  });
});
