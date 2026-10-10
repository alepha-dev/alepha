import { describe, it } from "vitest";

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
