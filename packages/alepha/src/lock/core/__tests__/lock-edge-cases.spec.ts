import { $inject, Alepha, createPrimitive } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { LockPrimitive, LockProvider } from "alepha/lock";
import { describe, it } from "vitest";

describe("$lock edge cases", () => {
  it("wait mode gives up after maxDuration when lock is permanently held", async ({
    expect,
  }) => {
    let executed = false;

    class TestApp {
      dt = $inject(DateTimeProvider);
      lock = $inject(LockProvider);

      fn = createPrimitive(LockPrimitive, {
        wait: true,
        maxDuration: [2, "seconds"],
        handler: async () => {
          executed = true;
        },
      });
    }

    const alepha = Alepha.create();
    alepha.with(TestApp);
    await alepha.start();

    const app = alepha.inject(TestApp);

    // Pre-acquire the lock with a foreign ID that never releases
    await app.lock.set(
      "TestApp:fn",
      "foreign-id,2026-01-01T00:00:00Z",
      true,
      300_000,
    );

    const start = Date.now();
    await app.fn.run();
    const elapsed = Date.now() - start;

    // Should give up after ~2 seconds, not loop forever
    expect(elapsed).toBeGreaterThanOrEqual(2000);
    expect(elapsed).toBeLessThan(10000);
    expect(executed).toBe(false);
  });

  it("wait mode executes handler after lock holder finishes", async ({
    expect,
  }) => {
    const order: string[] = [];

    class App1 {
      dt = $inject(DateTimeProvider);
      fn = createPrimitive(LockPrimitive, {
        name: "shared-work",
        handler: async () => {
          order.push("app1-start");
          await this.dt.wait([100, "milliseconds"]);
          order.push("app1-end");
        },
      });
    }

    class App2 {
      dt = $inject(DateTimeProvider);
      fn = createPrimitive(LockPrimitive, {
        name: "shared-work",
        wait: true,
        handler: async () => {
          order.push("app2-start");
          await this.dt.wait([100, "milliseconds"]);
          order.push("app2-end");
        },
      });
    }

    const alepha = Alepha.create();
    alepha.with(App1);
    alepha.with(App2);
    await alepha.start();

    const app1 = alepha.inject(App1);
    const app2 = alepha.inject(App2);

    await Promise.all([app1.fn.run(), app2.fn.run()]);

    // Both handlers should have executed
    expect(order).toContain("app1-start");
    expect(order).toContain("app1-end");
    expect(order).toContain("app2-start");
    expect(order).toContain("app2-end");

    // app1 should finish before app2 starts (sequential execution)
    expect(order.indexOf("app1-end")).toBeLessThan(order.indexOf("app2-start"));
  });

  it("wait mode releases lock on handler error", async ({ expect }) => {
    let secondRan = false;

    class TestApp {
      dt = $inject(DateTimeProvider);
      lock = $inject(LockProvider);

      failing = createPrimitive(LockPrimitive, {
        name: "error-lock",
        handler: async () => {
          throw new Error("handler failed");
        },
      });

      succeeding = createPrimitive(LockPrimitive, {
        name: "error-lock",
        handler: async () => {
          secondRan = true;
        },
      });
    }

    const alepha = Alepha.create();
    alepha.with(TestApp);
    await alepha.start();

    const app = alepha.inject(TestApp);

    // First call fails
    await expect(app.failing.run()).rejects.toThrow("handler failed");

    // Second call should succeed — lock was released despite the error
    await app.succeeding.run();
    expect(secondRan).toBe(true);
  });

  it("no-wait mode skips when lock is held", async ({ expect }) => {
    let executed = false;

    class TestApp {
      lock = $inject(LockProvider);

      fn = createPrimitive(LockPrimitive, {
        name: "skip-lock",
        wait: false,
        handler: async () => {
          executed = true;
        },
      });
    }

    const alepha = Alepha.create();
    alepha.with(TestApp);
    await alepha.start();

    const app = alepha.inject(TestApp);

    // Pre-acquire with foreign ID
    await app.lock.set(
      "skip-lock",
      "foreign-id,2026-01-01T00:00:00Z",
      true,
      300_000,
    );

    await app.fn.run();
    expect(executed).toBe(false);
  });
});
