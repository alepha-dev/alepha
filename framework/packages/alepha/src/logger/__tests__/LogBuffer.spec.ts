import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { $logger, LogBufferProvider } from "../index.ts";

describe("LogBuffer", () => {
  class App {
    log = $logger();
  }

  it("should capture entries suppressed by the log level", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "info" } });
    const app = alepha.inject(App);
    const buffers = alepha.inject(LogBufferProvider);
    await alepha.start();

    const messages = alepha.context.run(
      () => {
        app.log.debug("below the level");
        app.log.info("at the level");
        return buffers.snapshot()?.map((entry) => entry.message);
      },
      { ...buffers.seed() },
    );

    expect(messages).toEqual(["below the level", "at the level"]);
  });

  it("should keep the last entries once the cap is reached", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    const buffers = alepha.inject(LogBufferProvider);
    await alepha.start();

    const messages = alepha.context.run(
      () => {
        for (let i = 0; i < 5; i++) {
          app.log.info(`entry ${i}`);
        }
        return buffers.snapshot()?.map((entry) => entry.message);
      },
      { ...buffers.seed(3) },
    );

    // The head of a truncated snapshot is the drop notice, covered on its own
    // below; what matters here is which entries survived.
    expect(messages?.slice(-3)).toEqual(["entry 2", "entry 3", "entry 4"]);
  });

  it("should report how many entries the cap discarded", async ({ expect }) => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    const buffers = alepha.inject(LogBufferProvider);
    await alepha.start();

    const entries = alepha.context.run(
      () => {
        for (let i = 0; i < 5; i++) {
          app.log.info(`entry ${i}`);
        }
        return buffers.snapshot();
      },
      { ...buffers.seed(2) },
    );

    expect(entries?.map((entry) => entry.message)).toEqual([
      "3 earlier entries dropped (buffer size 2)",
      "entry 3",
      "entry 4",
    ]);
    expect(entries?.[0].level).toBe("WARN");
  });

  it("should take its size from the alepha.logger.buffer state", async ({
    expect,
  }) => {
    const alepha = Alepha.create({ "alepha.logger.buffer": { size: 2 } });
    const app = alepha.inject(App);
    const buffers = alepha.inject(LogBufferProvider);
    await alepha.start();

    const messages = alepha.context.run(
      () => {
        for (let i = 0; i < 4; i++) {
          app.log.info(`entry ${i}`);
        }
        return buffers.snapshot()?.map((entry) => entry.message);
      },
      { ...buffers.seed() },
    );

    expect(messages).toEqual([
      "2 earlier entries dropped (buffer size 2)",
      "entry 2",
      "entry 3",
    ]);
  });

  it("should not capture anything when the size is zero", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    const buffers = alepha.inject(LogBufferProvider);
    await alepha.start();

    const snapshot = alepha.context.run(
      () => {
        app.log.info("dropped");
        return buffers.snapshot();
      },
      { ...buffers.seed(0) },
    );

    expect(snapshot).toBeUndefined();
  });

  it("should report nothing rather than an empty list when idle", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const buffers = alepha.inject(LogBufferProvider);
    await alepha.start();

    const snapshot = alepha.context.run(() => buffers.snapshot(), {
      ...buffers.seed(),
    });

    expect(snapshot).toBeUndefined();
  });

  it("should stay a no-op when no buffer was seeded", async ({ expect }) => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    const buffers = alepha.inject(LogBufferProvider);
    await alepha.start();

    const snapshot = alepha.context.run(() => {
      app.log.info("not captured");
      return buffers.snapshot();
    });

    expect(snapshot).toBeUndefined();
  });

  it("should capture redacted data, never the raw credentials", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);
    const buffers = alepha.inject(LogBufferProvider);
    await alepha.start();

    const entries = alepha.context.run(
      () => {
        app.log.info("outgoing", { headers: { authorization: "Bearer top" } });
        return buffers.snapshot();
      },
      { ...buffers.seed() },
    );

    expect(entries?.[0].data).toEqual({
      headers: { authorization: "[redacted]" },
    });
  });
});
