import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";
import { DateTimeProvider } from "../providers/DateTimeProvider.ts";

describe("travel() firing order", () => {
  const create = () => {
    const alepha = Alepha.create();
    return alepha.inject(DateTimeProvider);
  };

  it("should fire due timeouts in expiry order, not creation order", async () => {
    // Real timers fire by expiry. A single travel() past several expiries
    // must preserve that order even when the timeouts were created in the
    // opposite one — code racing two timers (a lock TTL against an
    // operation deadline, say) sees the wrong winner otherwise.
    const time = create();
    const fired: string[] = [];

    time.wait([5, "minutes"]).then(() => fired.push("slow"));
    time.wait([1, "minute"]).then(() => fired.push("fast"));

    await time.travel([10, "minutes"]);

    expect(fired).toEqual(["fast", "slow"]);
  });

  it("should fire same-expiry timeouts in creation order", async () => {
    const time = create();
    const fired: string[] = [];

    time.wait([1, "minute"]).then(() => fired.push("first"));
    time.wait([1, "minute"]).then(() => fired.push("second"));

    await time.travel([2, "minutes"]);

    expect(fired).toEqual(["first", "second"]);
  });
});
