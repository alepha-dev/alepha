import { randomUUID } from "node:crypto";
import { $hook, $inject, Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { DatabaseProvider } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";
import { CartService } from "../cart/services/CartService.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { AlephaCommerceNotifications } from "../notifications/index.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { StockService } from "../services/StockService.ts";

/**
 * Records what a `commerce:order:paid` subscriber can observe at the moment
 * the event fires.
 *
 * `txAtEmit` is the ambient transaction marker: anything but `undefined` means
 * the subscriber's queries would join a still-open transaction. `statusSeen`
 * is read through `DatabaseProvider.execute`, which goes straight to the
 * connection pool and never joins that marker — so it reports what any other
 * connection (another request, another process) sees at that instant. Only a
 * committed order can show up as `paid` there.
 */
class OrderPaidProbe {
  alepha = $inject(Alepha);
  db = $inject(DatabaseProvider);

  txAtEmit: unknown = "hook-never-ran";
  statusSeen?: string;

  onPaid = $hook({
    on: "commerce:order:paid",
    handler: async (event) => {
      this.txAtEmit = this.alepha.get("alepha.orm.tx");
      const rows = await this.db.execute(
        `select status from commerce_orders where id = '${event.orderId}'`,
      );
      this.statusSeen = rows[0]?.status as string;
    },
  });
}

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaCommerceNotifications);

  const ctx = {
    alepha,
    catalog: alepha.inject(CatalogService),
    carts: alepha.inject(CartService),
    checkout: alepha.inject(CheckoutService),
    stock: alepha.inject(StockService),
    payments: alepha.inject(PaymentService),
    probe: alepha.inject(OrderPaidProbe),
  };
  await alepha.start();
  return ctx;
};

describe("commerce:order:paid", () => {
  /**
   * Regression: the webhook path reaches `OrderService.markPaid` from inside
   * `CheckoutService.settle`'s own transaction (payments:captured →
   * CheckoutSettlementListener → settle). markPaid's inner `transactional()`
   * joins that outer transaction, so an emit placed merely "after markPaid's
   * block" still fires while the outer transaction — and its row locks on
   * orders and stock — is open. Subscribers (invoice issue, confirmation
   * email over SMTP) would then hold those locks for as long as they run.
   */
  it("fires after the outermost transaction commits in the webhook path", async ({
    expect,
  }) => {
    const ctx = await setup();
    const ring = await ctx.catalog.create({
      slug: `ring-${randomUUID()}`,
      name: "Bague Aurore",
      price: 8900,
      published: true,
      config: { trackStock: true },
    });
    await ctx.stock.recordIntake(ring.id, 2);

    const cart = await ctx.carts.resolve(ctx.carts.newToken());
    await ctx.carts.add(cart.id, ring.id, 1);
    const opened = await ctx.checkout.start(cart.id, {
      email: "camille@example.com",
    });
    const { handoff } = await ctx.checkout.pay(opened.id, {
      returnUrl: "https://bijoux.example/merci",
    });

    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

    // The subscriber ran outside any open transaction ...
    expect(ctx.probe.txAtEmit).toBeUndefined();
    // ... and a plain pooled connection already saw the committed order.
    expect(ctx.probe.statusSeen).toBe("paid");
  });
});
