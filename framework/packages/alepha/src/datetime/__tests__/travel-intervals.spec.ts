import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { $interval, DateTimeProvider } from "../index.ts";

describe("travel() and intervals", () => {
  it("fires an every-30-minute interval four times across two one-hour hops", async () => {
    let ticks = 0;

    class App {
      loop = $interval({
        duration: [30, "minutes"],
        handler: () => {
          ticks += 1;
        },
      });
    }

    const alepha = Alepha.create();
    alepha.inject(App);
    const dateTime = alepha.inject(DateTimeProvider);
    await alepha.start();

    // start() runs the handler once before arming; count from there.
    const base = ticks;

    await dateTime.travel([1, "hour"]);
    await dateTime.travel([1, "hour"]);

    expect(ticks - base).toBe(4);

    await alepha.stop();
  });

  it("carries the remainder of hops shorter than the period", async () => {
    let ticks = 0;

    class App {
      loop = $interval({
        duration: [30, "minutes"],
        handler: () => {
          ticks += 1;
        },
      });
    }

    const alepha = Alepha.create();
    alepha.inject(App);
    const dateTime = alepha.inject(DateTimeProvider);
    await alepha.start();

    const base = ticks;

    // Each hop is shorter than the period, so flooring them in isolation
    // fired nothing at all. Together they cover one hour: two ticks.
    await dateTime.travel([20, "minutes"]);
    expect(ticks - base).toBe(0);

    await dateTime.travel([20, "minutes"]);
    expect(ticks - base).toBe(1);

    await dateTime.travel([20, "minutes"]);
    expect(ticks - base).toBe(2);

    await alepha.stop();
  });

  it("hands a suspended interval back to the real clock on reset()", async () => {
    let ticks = 0;

    class App {
      loop = $interval({
        duration: [10, "milliseconds"],
        handler: () => {
          ticks += 1;
        },
      });
    }

    const alepha = Alepha.create();
    alepha.inject(App);
    const dateTime = alepha.inject(DateTimeProvider);
    await alepha.start();

    dateTime.pause();
    await dateTime.travel([1, "second"]);

    const suspended = ticks;
    dateTime.reset();

    // Without the re-arm, travel() owned the interval for good and no real
    // timer ever ran it again.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(ticks).toBeGreaterThan(suspended);

    await alepha.stop();
  });
});
