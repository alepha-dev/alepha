import { afterEach, describe, it } from "vitest";

import {
  $hook,
  type Alepha,
  type RunHost,
  type RunOptions,
  run,
} from "../index.ts";

const key = Symbol.for("alepha.run.host");

describe("run with a RunHost installed", () => {
  afterEach(() => {
    delete (globalThis as any)[key];
  });

  it("hands the application and its options to the host and schedules nothing", async ({
    expect,
  }) => {
    let started = false;
    class App {
      protected readonly onStart = $hook({
        on: "start",
        handler: () => void (started = true),
      });
    }
    const attached: Array<[Alepha, RunOptions | undefined]> = [];
    const host: RunHost = {
      attach: (alepha, options) => void attached.push([alepha, options]),
    };
    (globalThis as any)[key] = host;
    const options: RunOptions = {
      configure: () => {},
      env: { LOG_LEVEL: "silent" },
    };

    const alepha = run(App, options);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(attached).toHaveLength(1);
    expect(attached[0][0]).toBe(alepha);
    expect(attached[0][1]).toBe(options);
    expect(started).toBe(false);
    expect(alepha.isStarted()).toBe(false);
    expect((globalThis as any).__alepha).toBe(alepha);
  });

  it("lets the host refuse options by throwing from attach", ({ expect }) => {
    (globalThis as any)[key] = {
      attach: (_: Alepha, options?: RunOptions) => {
        if (options?.once) throw new Error("no once");
      },
    } satisfies RunHost;

    expect(() =>
      run(class App {}, { once: true, env: { LOG_LEVEL: "silent" } }),
    ).toThrow("no once");
  });

  it("is not consulted when the CLI imports the entry", async ({ expect }) => {
    const attached: Alepha[] = [];
    (globalThis as any)[key] = {
      attach: (alepha: Alepha) => void attached.push(alepha),
    } satisfies RunHost;
    const previous = process.env.ALEPHA_CLI_IMPORT;
    process.env.ALEPHA_CLI_IMPORT = "true";
    try {
      run(class App {}, { env: { LOG_LEVEL: "silent" } });
    } finally {
      if (previous === undefined) delete process.env.ALEPHA_CLI_IMPORT;
      else process.env.ALEPHA_CLI_IMPORT = previous;
      delete (globalThis as any).__cli_alepha;
    }
    expect(attached).toEqual([]);
  });
});
