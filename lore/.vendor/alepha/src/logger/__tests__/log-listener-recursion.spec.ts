import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import {
  $logger,
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "../index.ts";

class App {
  log = $logger();
}

/**
 * A listener that throws on `log` was reported through the logger, and the
 * logger's emit dispatches `log` again: the same listener threw again, and the
 * stack ran out on the first log line after it registered.
 */
describe("a log listener that throws", () => {
  const boot = () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "trace" } }).with({
      provide: LogDestinationProvider,
      use: MemoryDestinationProvider,
    });
    return {
      alepha,
      app: alepha.inject(App),
      output: alepha.inject(MemoryDestinationProvider),
    };
  };

  it("is called once per log line, not until the stack overflows", async () => {
    const { alepha, app } = boot();

    let calls = 0;
    alepha.events.on("log", () => {
      calls += 1;
      throw new Error("subscriber is broken");
    });

    // Silence the console.error the report now goes to, so a deliberately
    // failing listener does not print during the suite. Restored either way.
    const consoleError = console.error;
    const reports: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      reports.push(args);
    };

    try {
      app.log.info("first");
      app.log.info("second");
    } finally {
      console.error = consoleError;
    }

    expect(calls).toBe(2);
    expect(reports).toHaveLength(2);
    expect(String(reports[0][0])).toContain("log(");
  });

  it("still writes the line it was listening to", async () => {
    const { alepha, app, output } = boot();

    alepha.events.on("log", () => {
      throw new Error("subscriber is broken");
    });

    const consoleError = console.error;
    console.error = () => {};

    try {
      app.log.info("written anyway");
    } finally {
      console.error = consoleError;
    }

    // The destination is written independently of the event, so routing the
    // report away from the logger costs no output.
    expect(output.logs.map((it) => it.message)).toContain("written anyway");
  });

  it("still reports a non-log listener through the logger", async () => {
    const { alepha, output } = boot();

    alepha.events.on("start", () => {
      throw new Error("start subscriber is broken");
    });

    await alepha.events.emit("start", undefined as never, { catch: true });

    expect(
      output.logs.some(
        (it) => it.level === "ERROR" && it.message.includes("start("),
      ),
    ).toBe(true);
  });
});
