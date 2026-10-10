import { describe, it } from "vitest";

import { DesktopProtocol } from "../DesktopProtocol.ts";

describe("DesktopProtocol", () => {
  const protocol = new DesktopProtocol();

  it("accepts a well-formed init and stop, and nothing else", ({ expect }) => {
    const init = {
      type: "init",
      version: 1,
      name: "Loom",
      identifier: "dev.alepha.loom",
      env: { NODE_ENV: "production" },
      capability: "0f".repeat(32),
    };
    expect(protocol.parseShellMessage(init)).toEqual(init);
    expect(protocol.parseShellMessage({ type: "stop" })).toEqual({
      type: "stop",
    });

    expect(protocol.parseShellMessage({ ...init, version: 2 })).toBeUndefined();
    expect(
      protocol.parseShellMessage({ ...init, capability: "short" }),
    ).toBeUndefined();
    expect(protocol.parseShellMessage({ type: "start" })).toBeUndefined();
    expect(protocol.parseShellMessage("init")).toBeUndefined();
  });

  it("accepts a ready only on an IPv4 loopback origin", ({ expect }) => {
    expect(
      protocol.parseWorkerMessage({
        type: "ready",
        version: 1,
        origin: "http://127.0.0.1:51234",
      }),
    ).toBeDefined();
    expect(
      protocol.parseWorkerMessage({
        type: "ready",
        version: 1,
        origin: "http://0.0.0.0:3000",
      }),
    ).toBeUndefined();
    expect(
      protocol.parseWorkerMessage({
        type: "ready",
        version: 1,
        origin: "http://localhost:3000",
      }),
    ).toBeUndefined();
    expect(protocol.parseWorkerMessage({ type: "stopped" })).toEqual({
      type: "stopped",
    });
  });

  it("keeps the message of a Bun uncaught error and drops its source excerpt and stack", ({
    expect,
  }) => {
    const worker =
      '14 | \n15 |   protected readonly crash = $route({\n19 |         throw new AlephaError("x");\n                   ^\nAlephaError: injected runtime crash\n      at <anonymous> (/src/app.ts:19:15)\n';
    expect(protocol.sanitize(worker)).toBe("injected runtime crash");

    const compiled =
      'error: 2 | // @bun\n3 | // src/app.ts\n5 |   throw new Error("injected startup failure");\n            ^\nerror: injected startup failure\n      at /$bunfs/root/app.js:5:9\n';
    expect(protocol.sanitize(compiled)).toBe("injected startup failure");

    expect(protocol.sanitize(new Error("plain"))).toBe("plain");
    expect(protocol.sanitize(undefined)).toBe("Unknown error");
    expect(protocol.sanitize("x".repeat(900))).toHaveLength(500);
  });
});
