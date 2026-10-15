import { $inject, $pipeline, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $lock, LockAcquireError, LockProvider } from "alepha/lock";
import { describe, it } from "vitest";

describe("$lock edge cases", () => {
  it("wait mode gives up after maxDuration when lock is permanently held", async ({
    expect,
  }) => {
    let executed = false;

    class TestApp {
      lock = $inject(LockProvider);

      fn = $pipeline({
        use: [
          $lock({
            name: "held-forever",
            wait: true,
            maxDuration: [2, "seconds"],
          }),
        ],
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
      "held-forever",
      "foreign-id,2026-01-01T00:00:00Z",
      true,
      300_000,
    );

    const start = Date.now();
    await expect(app.fn()).rejects.toThrow(LockAcquireError);
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

    class TestApp {
      dt = $inject(DateTimeProvider);

      first = $pipeline({
        use: [$lock({ name: "shared-work" })],
        handler: async () => {
          order.push("first-start");
          await this.dt.wait([100, "milliseconds"]);
          order.push("first-end");
        },
      });

      second = $pipeline({
        use: [$lock({ name: "shared-work", wait: true })],
        handler: async () => {
          order.push("second-start");
          await this.dt.wait([100, "milliseconds"]);
          order.push("second-end");
        },
      });
    }

    const alepha = Alepha.create();
    alepha.with(TestApp);
    await alepha.start();

    const app = alepha.inject(TestApp);

    await Promise.all([app.first(), app.second()]);

    expect(order).toEqual([
      "first-start",
      "first-end",
      "second-start",
      "second-end",
    ]);
  });

  it("releases the lock when the handler throws", async ({ expect }) => {
    let secondRan = false;

    class TestApp {
      failing = $pipeline({
        use: [$lock({ name: "error-lock" })],
        handler: async () => {
          throw new Error("handler failed");
        },
      });

      succeeding = $pipeline({
        use: [$lock({ name: "error-lock" })],
        handler: async () => {
          secondRan = true;
        },
      });
    }

    const alepha = Alepha.create();
    alepha.with(TestApp);
    await alepha.start();

    const app = alepha.inject(TestApp);

    await expect(app.failing()).rejects.toThrow("handler failed");

    // The lock was released despite the error.
    await app.succeeding();
    expect(secondRan).toBe(true);
  });
});
