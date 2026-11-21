import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { DateTimeProvider } from "../index.ts";

describe("alepha.datetime.DateTimeProvider", () => {
  it("should pause time and reset", async () => {
    const app = Alepha.create();
    const dt = app.inject(DateTimeProvider);
    const clock = () => dt.nowISOString();

    const n1 = clock();
    await new Promise((resolve) => setTimeout(resolve, 10));

    dt.pause();
    const n2 = clock();

    expect(n1).not.toBe(n2);
    expect(n2).toBe(clock());
    expect(n2).toBe(clock());
    expect(n2).toBe(clock());

    dt.reset();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(n2).not.toBe(clock());
  });

  it("should time travel and trigger scheduled callbacks", async () => {
    const stack: string[] = [];
    const app = Alepha.create();
    const dt = app.inject(DateTimeProvider);

    stack.push("A");

    // Registered, not awaited: the clock has not moved yet, so awaiting here
    // would block the `travel()` below that is what releases these timers.
    void dt.wait([10, "minutes"]).then(() => stack.push("B"));
    void dt.wait([20, "minutes"]).then(() => stack.push("C"));

    expect(stack).toEqual(["A"]);

    await dt.travel([5, "minutes"]);

    expect(stack).toEqual(["A"]);

    await dt.travel([30, "minutes"]);

    expect(stack).toEqual(["A", "B", "C"]);
  });

  it("should handle timeouts with clearTimeout", async () => {
    const app = Alepha.create();
    const dt = app.inject(DateTimeProvider);
    const stack: string[] = [];

    dt.createTimeout(() => stack.push("A"), [10, "minutes"]);
    const n2 = dt.createTimeout(() => stack.push("B"), [10, "minutes"]);

    expect(stack).toEqual([]);

    await dt.travel([5, "minutes"]);
    expect(stack).toEqual([]);

    dt.clearTimeout(n2);

    await dt.travel([5, "minutes"]);
    expect(stack).toEqual(["A"]);
  });

  it("should wait with abort signal support", async () => {
    const app = Alepha.create();
    const dt = app.inject(DateTimeProvider);
    const stack: string[] = [];

    const abortController = new AbortController();
    // Deliberately not awaited: the point of the test is that this chain never
    // completes, so the wait is started, observed not to have fired, aborted.
    void dt
      .wait([10, "minutes"], { signal: abortController.signal })
      .then(() => stack.push("A"));

    expect(stack).toEqual([]);

    abortController.abort();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(stack).toEqual(["A"]);
  });
});

describe("DateTimeProvider.nowMillis", () => {
  it("should return frozen millis when paused", () => {
    const app = Alepha.create();
    const dt = app.inject(DateTimeProvider);

    dt.pause();
    const a = dt.nowMillis();
    const b = dt.nowMillis();

    expect(a).toBe(b);
  });

  it("should advance millis after travel", async () => {
    const app = Alepha.create();
    const dt = app.inject(DateTimeProvider);

    dt.pause();
    const before = dt.nowMillis();

    await dt.travel([5, "minutes"]);
    const after = dt.nowMillis();

    expect(after - before).toBe(5 * 60 * 1000);
  });
});

describe("DateTimeProvider.duration", () => {
  it("should pass through an existing Duration object", () => {
    const app = Alepha.create();
    const dt = app.inject(DateTimeProvider);

    const dur = dt.duration([5, "seconds"]);
    const same = dt.duration(dur);

    expect(same).toBe(dur);
    expect(same.asMilliseconds()).toBe(5000);
  });
});

describe("DateTimeProvider.travel: reschedule surviving timeout", () => {
  it("should reschedule a timeout that has not yet expired", async () => {
    const app = Alepha.create();
    const dt = app.inject(DateTimeProvider);
    const stack: string[] = [];

    dt.createTimeout(() => stack.push("A"), [10, "minutes"]);

    // travel less than 10 minutes: timeout survives
    await dt.travel([3, "minutes"]);
    expect(stack).toEqual([]);

    // travel past the remaining time: timeout fires
    await dt.travel([8, "minutes"]);
    expect(stack).toEqual(["A"]);
  });
});

describe("DateTimeProvider.clearInterval", () => {
  it("should stop a running interval", async () => {
    const app = Alepha.create();
    const dt = app.inject(DateTimeProvider);
    let count = 0;

    const interval = dt.createInterval(
      () => count++,
      [5, "milliseconds"],
      true,
    );

    await new Promise((r) => setTimeout(r, 40));
    expect(count).toBeGreaterThan(0);
    dt.clearInterval(interval);

    const countAfterClear = count;
    await new Promise((r) => setTimeout(r, 40));

    expect(count).toBe(countAfterClear);
    expect(interval.duration).toBe(0);
    expect(interval.timer).toBeNull();
  });
});
