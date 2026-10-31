import { $inject, $store } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { CartService } from "../../cart/services/CartService.ts";
import { checkoutConfig } from "../checkoutConfigAtom.ts";
import { checkoutSessions } from "../entities/checkoutSessions.ts";

/**
 * Tidies what visitors leave behind: carts past their expiry, and checkouts
 * that never reached payment. Both grow with every visitor who adds something
 * to a cart, and nothing else reads them after a few days.
 *
 * A `paying` session is left to the payment module's expiry sweep, and its cart
 * with it: the capture may still land, and settling needs the cart.
 */
export class CheckoutSweeper {
  protected readonly carts = $inject(CartService);
  protected readonly sessions = $repository(checkoutSessions);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly config = $store(checkoutConfig);

  protected readonly sweepJob = $job({
    name: "system.commerce.sweep-checkouts",
    description: "Deletes expired carts and abandons stale open checkouts.",
    cron: this.config.cartSweepCron,
    timeout: [60, "seconds"],
    handler: async () => {
      await this.sweep();
    },
  });

  /**
   * Abandon first: a stale session is what still points at an expired cart,
   * and the recovery sequence reads the cart while the session is open.
   */
  public async sweep(): Promise<{ carts: number; sessions: number }> {
    const cutoff = this.dateTime
      .now()
      .subtract(this.config.abandonOpenAfterDays, "day")
      .toISOString();

    const abandoned = await this.sessions.updateMany(
      { status: { eq: "open" }, updatedAt: { lt: cutoff } },
      { status: "abandoned" },
    );

    const deleted = await this.carts.deleteExpired(
      this.sessions.subquery(
        { status: { inArray: ["open", "paying"] } },
        "cartId",
      ),
    );

    return { carts: deleted, sessions: abandoned.length };
  }
}
