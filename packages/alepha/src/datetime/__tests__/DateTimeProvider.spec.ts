import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { DateTimeProvider } from "../index.ts";

describe("DateTimeProvider", () => {
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

    dt.wait([10, "minutes"]).then(() => stack.push("B"));
    dt.wait([20, "minutes"]).then(() => stack.push("C"));

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
    dt.wait([10, "minutes"], { signal: abortController.signal }).then(() =>
      stack.push("A"),
    );

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

describe("DateTimeProvider.deadline", () => {
  it("should return result when handler completes in time", async () => {
    const app = Alepha.create();
    const dt = app.inject(DateTimeProvider);

    const result = await dt.deadline(async () => "done", [1, "seconds"]);

    expect(result).toBe("done");
  });

  it("should abort signal when handler exceeds deadline", async () => {
    const app = Alepha.create();
    const dt = app.inject(DateTimeProvider);
    let aborted = false;

    const promise = dt.deadline(
      async (signal) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        await dt.wait([10, "minutes"]);
        return "done";
      },
      [5, "minutes"],
    );

    // Travel past deadline (5min) but handler is still waiting (10min)
    await dt.travel([5, "minutes"]);
    expect(aborted).toBe(true);

    // Travel remaining time so handler resolves
    await dt.travel([5, "minutes"]);
    await expect(promise).resolves.toBe("done");
  });
});

describe("DateTimeProvider.isDurationLike", () => {
  it("should return true for valid durations", () => {
    const app = Alepha.create();
    const dt = app.inject(DateTimeProvider);

    expect(dt.isDurationLike(1000)).toBe(true);
    expect(dt.isDurationLike([5, "minutes"])).toBe(true);
  });

  it("should return false for invalid values", () => {
    const app = Alepha.create();
    const dt = app.inject(DateTimeProvider);

    expect(dt.isDurationLike("not-a-duration")).toBe(false);
    expect(dt.isDurationLike(null)).toBe(false);
    expect(dt.isDurationLike(undefined)).toBe(false);
    expect(dt.isDurationLike({})).toBe(false);
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

describe("DateTimeProvider.travel — reschedule surviving timeout", () => {
  it("should reschedule a timeout that has not yet expired", async () => {
    const app = Alepha.create();
    const dt = app.inject(DateTimeProvider);
    const stack: string[] = [];

    dt.createTimeout(() => stack.push("A"), [10, "minutes"]);

    // travel less than 10 minutes — timeout survives
    await dt.travel([3, "minutes"]);
    expect(stack).toEqual([]);

    // travel past the remaining time — timeout fires
    await dt.travel([8, "minutes"]);
    expect(stack).toEqual(["A"]);
  });
});

describe("DateTimeProvider.createTimeout — replay with ref", () => {
  it("should fire immediately when replaying a past timeout", async () => {
    const app = Alepha.create();
    const dt = app.inject(DateTimeProvider);
    const stack: string[] = [];

    // Pause time at a known point, then travel forward
    dt.pause();
    await dt.travel([30, "minutes"]);

    // Create a timeout with a `now` in the past — should fire immediately
    const pastNow = dt.now().subtract(20, "minutes").valueOf();
    dt.createTimeout(() => stack.push("replayed"), [10, "minutes"], pastNow);

    expect(stack).toEqual(["replayed"]);
  });

  it("should not fire when replay timeout is still in the future", async () => {
    const app = Alepha.create();
    const dt = app.inject(DateTimeProvider);
    const stack: string[] = [];

    dt.pause();
    await dt.travel([5, "minutes"]);

    // Create a timeout with a `now` that puts expiry in the future
    const recentNow = dt.now().subtract(1, "minutes").valueOf();
    dt.createTimeout(() => stack.push("future"), [10, "minutes"], recentNow);

    expect(stack).toEqual([]);
  });
});

describe("DateTimeProvider.clearInterval", () => {
  it("should stop a running interval", async () => {
    const app = Alepha.create();
    const dt = app.inject(DateTimeProvider);
    let count = 0;

    const interval = dt.createInterval(() => count++, [10, "seconds"], true);

    await new Promise((r) => setTimeout(r, 10));
    dt.clearInterval(interval);

    const countAfterClear = count;
    await new Promise((r) => setTimeout(r, 20));

    expect(count).toBe(countAfterClear);
    expect(interval.duration).toBe(0);
    expect(interval.timer).toBeNull();
  });
});
