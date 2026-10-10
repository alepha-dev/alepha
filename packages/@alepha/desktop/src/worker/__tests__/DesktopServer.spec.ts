import { describe, it } from "vitest";

import { DesktopAdmission } from "../DesktopAdmission.ts";
import { DesktopServer } from "../DesktopServer.ts";

const fakeBun = () => {
  const calls: any[] = [];
  const bun = {
    serve: ((options: any) => {
      calls.push(options);
      return { hostname: options.hostname, port: 50000 };
    }) as any,
  };
  return { bun, calls };
};

describe("DesktopServer", () => {
  it("records the bound origin of a 127.0.0.1:0 server", ({ expect }) => {
    const { bun, calls } = fakeBun();
    const server = new DesktopServer();
    server.install(bun);

    expect(server.origin()).toBeUndefined();
    bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => {} });
    expect(calls).toHaveLength(1);
    expect(server.origin()).toBe("http://127.0.0.1:50000");
  });

  it("refuses an app that binds anything but 127.0.0.1 on port 0", ({
    expect,
  }) => {
    for (const options of [
      { hostname: "0.0.0.0", port: 0 },
      { hostname: "localhost", port: 0 },
      { hostname: "::1", port: 0 },
      { hostname: "127.0.0.1", port: 3000 },
      { port: 0 },
      { unix: "/tmp/app.sock" },
    ]) {
      const { bun, calls } = fakeBun();
      new DesktopServer().install(bun);
      expect(() => bun.serve(options)).toThrow(
        /desktop app listens on 127\.0\.0\.1/,
      );
      expect(calls).toHaveLength(0);
    }
  });

  it("refuses routes and static options, which would bypass the guard", ({
    expect,
  }) => {
    for (const extra of [
      { routes: { "/": new Response("x") } },
      { static: { "/": new Response("x") } },
    ]) {
      const { bun } = fakeBun();
      new DesktopServer().install(bun);
      expect(() =>
        bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: () => {},
          ...extra,
        }),
      ).toThrow("would bypass it");
    }
  });

  it("runs admission before the app's fetch, so a refused or bootstrap request never reaches the app", async ({
    expect,
  }) => {
    const { bun, calls } = fakeBun();
    const server = new DesktopServer();
    const capability = "ab".repeat(32);
    server.guard(new DesktopAdmission({ capability, identifier: "a.b" }));
    server.install(bun);
    const seen: string[] = [];
    bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request: Request) => {
        seen.push(new URL(request.url).pathname);
        return new Response("app");
      },
    });
    const fetch = calls[0].fetch;
    const at = (path: string, headers: Record<string, string> = {}) =>
      fetch(
        new Request(`http://127.0.0.1:50000${path}`, {
          headers: { host: "127.0.0.1:50000", ...headers },
        }),
        {
          port: 50000,
        },
      );

    expect((await at("/hello")).status).toBe(403);
    const boot = await at(
      `/__alepha_desktop/bootstrap?capability=${capability}`,
    );
    expect(boot.status).toBe(303);
    const cookie = boot.headers.get("set-cookie")!.split(";")[0];
    expect(await (await at("/hello", { cookie })).text()).toBe("app");
    expect(seen).toEqual(["/hello"]);
  });

  it("refuses a second server, and uninstall restores Bun.serve", ({
    expect,
  }) => {
    const { bun } = fakeBun();
    const original = bun.serve;
    const server = new DesktopServer();
    server.install(bun);
    bun.serve({ hostname: "127.0.0.1", port: 0 });
    expect(() => bun.serve({ hostname: "127.0.0.1", port: 0 })).toThrow(
      "exactly one HTTP server",
    );

    server.uninstall(bun);
    expect(bun.serve).toBe(original);
  });
});
