import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { DateTimeProvider } from "../index.ts";

class TestDateTimeProvider extends DateTimeProvider {
  public pendingTimeouts = () => this.timeouts.length;
}

describe("DateTimeProvider.wait with an already aborted signal", () => {
  it("resolves at once, leaving no timer", async () => {
    const dt = Alepha.create().inject(TestDateTimeProvider);

    const controller = new AbortController();
    controller.abort();

    const waiting = dt.wait([1, "hour"], { signal: controller.signal });

    // A pending one-hour timeout here is the bug: the wait would resolve an
    // hour later, and the timer would hold the process open until then.
    expect(dt.pendingTimeouts()).toBe(0);

    const first = await Promise.race([
      waiting.then(() => "wait"),
      new Promise((resolve) => setTimeout(() => resolve("timer"), 50)),
    ]);
    expect(first).toBe("wait");
  });
});
