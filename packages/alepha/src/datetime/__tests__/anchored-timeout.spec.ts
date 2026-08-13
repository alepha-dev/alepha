import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { DateTimeProvider } from "../providers/DateTimeProvider.ts";

describe("anchored timeouts on the real clock", () => {
  const create = () => {
    const alepha = Alepha.create();
    return alepha.inject(DateTimeProvider);
  };

  it("should measure the wait from the `now` anchor, not from the call instant", async () => {
    // `CronProvider.run()` re-anchors every tick with
    // `wait(interval, { now: previousTick })`. If the anchor is ignored the
    // full interval is waited from the call instant instead, so scheduling
    // lateness accumulates tick after tick and the cron grid drifts.
    const time = create();
    const start = time.nowMillis();

    await time.wait(1000, { now: start - 800 });

    const elapsed = time.nowMillis() - start;
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(700);
  });

  it("should resolve immediately when the anchored expiry has already passed", async () => {
    const time = create();
    const start = time.nowMillis();

    await time.wait(500, { now: start - 2000 });

    expect(time.nowMillis() - start).toBeLessThan(100);
  });

  it("should wait the full duration when no anchor is given", async () => {
    const time = create();
    const start = time.nowMillis();

    await time.wait(200);

    expect(time.nowMillis() - start).toBeGreaterThanOrEqual(180);
  });
});
