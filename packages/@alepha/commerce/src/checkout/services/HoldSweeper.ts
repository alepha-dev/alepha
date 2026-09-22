import { $inject, $store } from "alepha";
import { $job } from "alepha/api/jobs";

import { ResourceService } from "../../services/ResourceService.ts";
import { StockService } from "../../services/StockService.ts";
import { checkoutConfig } from "../checkoutConfigAtom.ts";

/**
 * Schedules the release of holds whose payment never arrived: stock holds
 * and interval holds, on the same tick.
 *
 * One job for both inventory shapes rather than a twin per ledger: one cron
 * to configure, and the reason it lives here is the same for both.
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
export class HoldSweeper {
  protected readonly stock = $inject(StockService);
  protected readonly resources = $inject(ResourceService);
  protected readonly config = $store(checkoutConfig);

  protected readonly releaseExpired = $job({
    name: "system.commerce.release-expired-holds",
    description:
      "Releases the stock and interval holds of checkouts whose reservation expired.",
    cron: this.config.stockSweepCron,
    timeout: [30, "seconds"],
    handler: async () => {
      await this.stock.releaseExpiredReservations();
      await this.resources.releaseExpiredReservations();
    },
  });
}
