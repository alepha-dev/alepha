import { Alepha } from "alepha";
import { CronProvider } from "alepha/scheduler";
import { describe, expect, it } from "vitest";

import { AlephaApiPayments, paymentsConfig } from "../index.ts";

/**
 * Guards the declaration-order hazard: `PaymentService.config` must stay
 * declared above the `$job` that reads it. Class fields initialize in order, so
 * moving it below leaves `this.config` undefined at `$job` construction — which
 * surfaces as a crash at inject time, not as a type error.
 */
describe("payments cron configuration", () => {
  const expressionOf = (alepha: Alepha) =>
    alepha
      .inject(CronProvider)
      .getCronJobs()
      .find((job) => job.name === "api:payments:expireStaleIntents")
      ?.expression;

  it("should default the stale-intent sweep to a quarter-hour tick", () => {
    const alepha = Alepha.create().with(AlephaApiPayments);

    expect(expressionOf(alepha)).toBe("*/15 * * * *");
  });

  it("should honour an app override applied before the module is wired", () => {
    const alepha = Alepha.create();
    alepha.store.mut(paymentsConfig, (c) => ({
      ...c,
      expireStaleIntentsCron: "*/5 * * * *",
    }));
    alepha.with(AlephaApiPayments);

    expect(expressionOf(alepha)).toBe("*/5 * * * *");
  });
});
