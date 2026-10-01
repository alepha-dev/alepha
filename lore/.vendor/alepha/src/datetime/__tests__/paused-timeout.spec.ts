import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { DateTimeProvider } from "../providers/DateTimeProvider.ts";

describe("paused-clock timeouts", () => {
  const create = () => {
    const alepha = Alepha.create();
    return alepha.inject(DateTimeProvider);
  };

  it("should fire a future replayed timeout on travel()", async () => {
    // A timeout replayed with an explicit `now` under a paused/travelled
    // clock returned an unregistered dummy when its expiry was still in the
    // future — travel() could never fire it, so a paused-clock cron chain
    // stalled permanently.
    const time = create();
    await time.travel([0, "milliseconds"]); // pin the clock

    let fired = false;
    const createdAt = time.now().valueOf();
    time.createTimeout(
      () => {
        fired = true;
      },
      [10, "minutes"],
      createdAt,
    );

    expect(fired).toBe(false);

    await time.travel([11, "minutes"]);

    expect(fired).toBe(true);
  });

  it("should fire immediately when the replayed expiry has already passed", async () => {
    const time = create();
    await time.travel([0, "milliseconds"]);

    const createdAt = time.now().valueOf();
    await time.travel([20, "minutes"]);

    let fired = false;
    time.createTimeout(
      () => {
        fired = true;
      },
      [10, "minutes"],
      createdAt,
    );

    expect(fired).toBe(true);
  });

  it("should not hang wait() with an explicit now", async () => {
    const time = create();
    await time.travel([0, "milliseconds"]);

    const createdAt = time.now().valueOf();
    const waiting = time.wait([5, "minutes"], { now: createdAt } as any);

    await time.travel([6, "minutes"]);

    await expect(waiting).resolves.toBeUndefined();
  });
});
