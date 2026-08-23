import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { DateTimeProvider } from "../index.ts";

describe("DateTimeProvider.wait with an elapsed anchor", () => {
  it("does not leave an abort listener behind", async () => {
    const alepha = Alepha.create();
    const dt = alepha.inject(DateTimeProvider);
    await alepha.start();

    const controller = new AbortController();
    const signal = controller.signal as any;
    let registered = 0;
    let removed = 0;
    const originalAdd = signal.addEventListener.bind(signal);
    const originalRemove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (...args: unknown[]) => {
      registered += 1;
      return originalAdd(...args);
    };
    signal.removeEventListener = (...args: unknown[]) => {
      removed += 1;
      return originalRemove(...args);
    };

    // An anchor in the past: the deadline has already elapsed, so wait()
    // resolves synchronously and has nothing left to cancel.
    const past = dt.nowMillis() - 10_000;
    for (let i = 0; i < 3; i++) {
      await dt.wait([1, "second"], { now: past, signal });
    }
    expect(registered - removed).toBe(0);

    // A pending wait still honours the signal.
    const pending = dt.wait([1, "hour"], { signal });
    controller.abort();
    await pending;

    await alepha.stop();
  });
});
