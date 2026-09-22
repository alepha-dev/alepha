import { Alepha } from "alepha";
import { CronProvider } from "alepha/scheduler";
import { describe, expect, it } from "vitest";

import { AlephaCommerceCheckout, checkoutConfig } from "../index.ts";

/**
 * Guards the declaration-order hazard: `HoldSweeper.config` must
 * stay declared above the `$job` that reads it. Class fields initialize in
 * order, so moving it below leaves `this.config` undefined at `$job`
 * construction — a crash at inject time, not a type error.
 */
describe("checkout cron configuration", () => {
  const expressionOf = (alepha: Alepha) =>
    alepha
      .inject(CronProvider)
      .getCronJobs()
      .find((job) => job.name === "system.commerce.release-expired-holds")
      ?.expression;

  it("should default the hold sweep to a quarter-hour tick", () => {
    const alepha = Alepha.create().with(AlephaCommerceCheckout);

    expect(expressionOf(alepha)).toBe("*/15 * * * *");
  });

  it("should honour an app override applied before the module is wired", () => {
    const alepha = Alepha.create();
    alepha.store.mut(checkoutConfig, (c) => ({
      ...c,
      stockSweepCron: "*/5 * * * *",
    }));
    alepha.with(AlephaCommerceCheckout);

    expect(expressionOf(alepha)).toBe("*/5 * * * *");
  });
});
