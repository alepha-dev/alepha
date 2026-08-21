import { $inject, $store } from "alepha";
import { $job } from "alepha/api/jobs";

import { StockService } from "../../services/StockService.ts";
import { checkoutConfig } from "../checkoutConfigAtom.ts";

/**
 * Schedules the release of stock holds whose payment never arrived.
 *
 * Lives in the checkout module rather than in the core one for a dependency
 * reason: `$job` comes from `alepha/api/jobs`, and a point-of-sale consumer —
 * which sells synchronously and so never takes a hold — should not have to carry
 * the job system. Checkout already depends on it through
 * `alepha/api/payments`, so here it is free.
 *
 * A sweep rather than a timer per hold: a sweep survives a restart and a timer
 * does not. Its cadence comes from {@link checkoutConfig} and is deliberately
 * coarse — see the atom for why a late tick is harmless here.
 */
export class StockReservationSweeper {
  protected readonly stock = $inject(StockService);
  protected readonly config = $store(checkoutConfig);

  protected readonly releaseExpired = $job({
    name: "commerce:stock:releaseExpiredReservations",
    cron: this.config.stockSweepCron,
    handler: async () => {
      await this.stock.releaseExpiredReservations();
    },
  });
}
