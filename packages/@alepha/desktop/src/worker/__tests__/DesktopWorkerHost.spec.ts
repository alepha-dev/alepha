import { $hook, Alepha } from "alepha";
import { describe, it } from "vitest";

import { DesktopServer } from "../DesktopServer.ts";
import { DesktopWorkerHost } from "../DesktopWorkerHost.ts";

/**
 * A server that reports a fixed origin, so the host runs under Node.
 */
class FixedServer extends DesktopServer {
  public override install(): void {}
  public override origin(): string | undefined {
    return "http://127.0.0.1:4321";
  }
}

const capability = "cd".repeat(32);

const setup = (entry: (host: DesktopWorkerHost) => Promise<unknown>) => {
  const posted: unknown[] = [];
  let listener: (event: { data: unknown }) => void = () => {};
  const env: Record<string, string | undefined> = {};
  const host: DesktopWorkerHost = new DesktopWorkerHost(
    {
      postMessage: (message) => posted.push(message),
      addEventListener: (_type, l) => {
        listener = l;
      },
    },
    () => entry(host),
    new FixedServer(),
    env,
  ).listen();
  const send = (data: unknown) => listener({ data });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  return { host, posted, send, settle, env };
};

describe("DesktopWorkerHost", () => {
  it("applies the env, starts after configure and answers ready, then stops through the hooks", async ({
    expect,
  }) => {
    const order: string[] = [];
    class App {
      protected readonly onStop = $hook({
        on: "stop",
        handler: () => void order.push("stop hook"),
      });
    }
    const { posted, send, settle, env } = setup(async (host) => {
      order.push("entry");
      host.attach(Alepha.create({ env: { LOG_LEVEL: "silent" } }).with(App), {
        configure: () => void order.push("configure"),
        ready: () => void order.push("ready"),
      });
    });

    send({
      type: "init",
      version: 1,
      name: "A",
      identifier: "a.b",
      env: { FOO: "bar" },
      capability,
    });
    await settle();

    expect(env.FOO).toBe("bar");
    expect(order).toEqual(["entry", "configure", "ready"]);
    expect(posted).toEqual([
      { type: "ready", version: 1, origin: "http://127.0.0.1:4321" },
    ]);

    send({ type: "stop" });
    await settle();
    expect(order).toContain("stop hook");
    expect(posted.at(-1)).toEqual({ type: "stopped" });
  });

  it("refuses a second run() and run({ once: true })", ({ expect }) => {
    const { host } = setup(async () => {});
    expect(() => host.attach(Alepha.create(), { once: true })).toThrow(
      "once: true",
    );
    host.attach(Alepha.create(), undefined);
    expect(() => host.attach(Alepha.create(), undefined)).toThrow(
      "run() was called twice",
    );
  });

  it("answers failed for a malformed message and for a second init", async ({
    expect,
  }) => {
    const { posted, send, settle } = setup(async (host) => {
      host.attach(Alepha.create({ env: { LOG_LEVEL: "silent" } }), undefined);
    });

    send({ type: "nope" });
    send({
      type: "init",
      version: 1,
      name: "A",
      identifier: "a.b",
      env: {},
      capability,
    });
    await settle();
    send({
      type: "init",
      version: 1,
      name: "A",
      identifier: "a.b",
      env: {},
      capability,
    });
    await settle();

    expect(posted).toEqual([
      expect.objectContaining({ type: "failed", phase: "protocol" }),
      { type: "ready", version: 1, origin: "http://127.0.0.1:4321" },
      {
        type: "failed",
        phase: "protocol",
        message: "The desktop shell sent init twice.",
      },
    ]);
  });

  it("stops what started when a ready callback throws", async ({ expect }) => {
    let stopped = false;
    class App {
      protected readonly onStop = $hook({
        on: "stop",
        handler: () => void (stopped = true),
      });
    }
    const { posted, send, settle } = setup(async (host) => {
      host.attach(Alepha.create({ env: { LOG_LEVEL: "silent" } }).with(App), {
        ready: () => {
          throw new Error("ready broke");
        },
      });
    });

    send({
      type: "init",
      version: 1,
      name: "A",
      identifier: "a.b",
      env: {},
      capability,
    });
    await settle();

    expect(stopped).toBe(true);
    expect(posted).toEqual([
      { type: "failed", phase: "start", message: "ready broke" },
    ]);
  });
});
