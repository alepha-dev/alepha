import { $hook, Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { $interval, DateTimeProvider } from "../index.ts";

describe("$interval", () => {
  it("should execute handler at specified intervals", async () => {
    const count = { value: 0 };
    class TestApp {
      loop = $interval({
        duration: [10, "seconds"],
        handler: () => {
          count.value += 1;
        },
      });
    }

    const alepha = Alepha.create({
      env: {},
    });
    const dt = alepha.inject(DateTimeProvider);
    const app = alepha.inject(TestApp);
    expect(app.loop.called).toBe(0);
    expect(count.value).toBe(0);

    expect(app.loop.called).toBe(0);
    expect(count.value).toBe(0);
    await alepha.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.loop.called).toBe(1);
    expect(count.value).toBe(1);

    await dt.travel([50, "seconds"]);
    expect(app.loop.called).toBe(6);
    expect(count.value).toBe(6);
  });

  it("should stop interval on abort", async () => {
    const count = { value: 0 };
    class TestApp {
      loop = $interval({
        duration: [10, "seconds"],
        handler: () => {
          count.value += 1;
        },
      });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(TestApp);
    expect(app.loop.called).toBe(0);
    expect(count.value).toBe(0);

    await alepha.start();
    expect(app.loop.called).toBe(1);
    expect(count.value).toBe(1);

    await alepha.stop();
    expect(app.loop.called).toBe(1);
    expect(count.value).toBe(1);
  });
});

describe("Alepha start lifecycle", () => {
  it("should track started and locked flags correctly", async () => {
    const app = Alepha.create({});
    const dt = app.inject(DateTimeProvider);

    expect(app.isStarted()).toBe(false);
    expect(app.isConfigured()).toBe(false);
    expect(app.isLocked()).toBe(false);

    const blocker = {
      resolve: () => {},
    };

    const end = new Promise<void>((resolve) => {
      blocker.resolve = resolve;
    });

    class LongStart {
      _ = $hook({
        on: "start",
        handler: async () => {
          blocker.resolve();
          await dt.wait([1, "minute"]);
        },
      });
    }

    const startEnd = app.with(LongStart).start();

    await end;

    expect(app.isLocked()).toBe(true);
    expect(app.isStarted()).toBe(false);

    await dt.travel([1, "minute"]);
    await startEnd;

    expect(app.isStarted()).toBe(true);
    expect(app.isLocked()).toBe(true);
  });
});
