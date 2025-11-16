import { Alepha, AlephaError } from "alepha";
import { describe, it } from "vitest";
import {
  $logger,
  LogDestinationProvider,
  LogFormatterProvider,
  MemoryDestinationProvider,
  SimpleFormatterProvider,
} from "../../src/logger";

describe("SimpleFormatterProvider", () => {
  class App {
    log = $logger();
  }

  it("should format log entries correctly without color", ({ expect }) => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "trace",
        NO_COLOR: "true", // Simulate no color output
      },
    })
      .with({
        provide: LogFormatterProvider,
        use: SimpleFormatterProvider,
      })
      .with({
        provide: LogDestinationProvider,
        use: MemoryDestinationProvider,
      });

    const app = alepha.inject(App);

    app.log.info("Test log message");

    const output = alepha.inject(MemoryDestinationProvider);
    const fmt = alepha.inject(SimpleFormatterProvider);

    expect(output.logs[0].formatted).toMatch(
      `[${fmt.formatTimestamp(output.logs[0].timestamp)}] INFO <app.App>: Test log message`,
    );
  });

  it("should format error", ({ expect }) => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "trace",
        NO_COLOR: "true", // Simulate no color output
      },
    })
      .with({
        provide: LogFormatterProvider,
        use: SimpleFormatterProvider,
      })
      .with({
        provide: LogDestinationProvider,
        use: MemoryDestinationProvider,
      });

    const app = alepha.inject(App);

    const error = new AlephaError("Test error message");
    const anotherError = new Error("Another error message", { cause: error });

    app.log.error("Test log message", anotherError);

    const output = alepha.inject(MemoryDestinationProvider);
    const fmt = alepha.inject(SimpleFormatterProvider);

    expect(output.logs[0].formatted).toContain(
      `[${fmt.formatTimestamp(output.logs[0].timestamp)}] ERROR <app.App>: Test log message`,
    );
    expect(output.logs[0].formatted).toContain("Error: Another error message");
    expect(output.logs[0].formatted).toContain(
      "Caused by: AlephaError: Test error message",
    );
  });

  it("should format log json", ({ expect }) => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "trace",
        NO_COLOR: "true", // Simulate no color output
      },
    })
      .with({
        provide: LogFormatterProvider,
        use: SimpleFormatterProvider,
      })
      .with({
        provide: LogDestinationProvider,
        use: MemoryDestinationProvider,
      });

    const app = alepha.inject(App);

    app.log.info("Test log message", {
      json: { key: "value" },
      anotherKey: 123,
    });

    const output = alepha.inject(MemoryDestinationProvider);
    const fmt = alepha.inject(SimpleFormatterProvider);

    expect(output.logs[0].formatted).toEqual(
      `[${fmt.formatTimestamp(output.logs[0].timestamp)}] INFO <app.App>: Test log message {"json":{"key":"value"},"anotherKey":123}`,
    );
  });
});
