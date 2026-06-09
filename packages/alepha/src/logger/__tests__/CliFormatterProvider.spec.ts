import { Alepha, AlephaError } from "alepha";
import { describe, it } from "vitest";
import {
  $logger,
  CliFormatterProvider,
  LogDestinationProvider,
  LogFormatterProvider,
  MemoryDestinationProvider,
} from "../index.ts";

describe("CliFormatterProvider", () => {
  class App {
    log = $logger();
  }

  const createApp = () =>
    Alepha.create({
      env: {
        LOG_LEVEL: "trace",
        NO_COLOR: "true",
      },
    })
      .with({
        provide: LogFormatterProvider,
        use: CliFormatterProvider,
      })
      .with({
        provide: LogDestinationProvider,
        use: MemoryDestinationProvider,
      });

  it("renders time, level initial and message (no module/service)", ({
    expect,
  }) => {
    const alepha = createApp();
    const app = alepha.inject(App);

    app.log.info("Starting 'alepha lint' ...");

    const output = alepha.inject(MemoryDestinationProvider);
    const fmt = alepha.inject(CliFormatterProvider);

    expect(output.logs[0].formatted).toBe(
      `${(fmt as any).formatClockTime(output.logs[0].timestamp)} I Starting 'alepha lint' ...`,
    );
  });

  it("appends structured data as json", ({ expect }) => {
    const alepha = createApp();
    const app = alepha.inject(App);

    app.log.info("Finished", { json: { key: "value" }, count: 2 });

    const output = alepha.inject(MemoryDestinationProvider);
    const fmt = alepha.inject(CliFormatterProvider);

    expect(output.logs[0].formatted).toBe(
      `${(fmt as any).formatClockTime(output.logs[0].timestamp)} I Finished {"json":{"key":"value"},"count":2}`,
    );
  });

  it("uses the level initial for warnings and errors", ({ expect }) => {
    const alepha = createApp();
    const app = alepha.inject(App);

    app.log.warn("a warning");
    const error = new AlephaError("boom");
    app.log.error("failed", new Error("wrapper", { cause: error }));

    const output = alepha.inject(MemoryDestinationProvider);

    expect(output.logs[0].formatted).toContain(" W a warning");
    expect(output.logs[1].formatted).toContain(" E failed");
    expect(output.logs[1].formatted).toContain("Caused by: AlephaError: boom");
  });
});
