import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { AlephaCommerceInvoicing } from "../invoicing/index.ts";
import { sellerIdentityAtom } from "../invoicing/sellerIdentityAtom.ts";
import { InvoiceService } from "../invoicing/services/InvoiceService.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { StockService } from "../services/StockService.ts";
import { AlephaCommerceSettlement } from "../settlement/index.ts";

/**
 * A refund that gives back part of the money must not read as one that undoes
 * the sale.
 *
 * Every refund event, whatever its amount, used to move the order to
 * `refunded`: a ten percent goodwill gesture looked, in the back office and in
 * the customer's own history, exactly like a cancelled sale — with the stock
 * put back on the shelf and a credit note on the books saying nothing was
 * owed.
 *
 * Driven through `PaymentService.refund` rather than `OrderService.refund`,
 * because the bug was in the wiring between them: the listener threw the
 * amount away.
 */
const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaCommerceInvoicing)
    .with(AlephaCommerceSettlement);

  alepha.store.set(sellerIdentityAtom.key, {
    name: "Atelier Aurore",
    address: "12 rue des Orfèvres, 75001 Paris",
    registrationNumber: "912 345 678 00012",
    legalForm: "SASU",
    vatNumber: "FR91234567800",
    numberPrefix: "FA",
  } as any);

  const ctx = {
    alepha,
    catalog: alepha.inject(CatalogService),
    carts: alepha.inject(CartService),
    checkout: alepha.inject(CheckoutService),
    orders: alepha.inject(OrderService),
    stock: alepha.inject(StockService),
    payments: alepha.inject(PaymentService),
    invoices: alepha.inject(InvoiceService),
  };
  await alepha.start();
  return ctx;
};

const aRing = (catalog: CatalogService) =>
  catalog.create({
    slug: `ring-${randomUUID()}`,
    name: "Bague Aurore",
    price: 8900,
    published: true,
    config: { trackStock: true },
  });

/**
 * Buy one ring through the real rail, and hand back the order and the intent
 * the refund has to be issued against.
 */
const buy = async (ctx: Awaited<ReturnType<typeof setup>>) => {
  const ring = await aRing(ctx.catalog);
  await ctx.stock.recordIntake(ring.id, 3);

  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  await ctx.carts.add(cart.id, ring.id, 1);
  const opened = await ctx.checkout.start(cart.id, {
    email: "camille@example.com",
  });
  const { session, handoff } = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://bijoux.example/merci",
  });
  await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

  const order = await ctx.orders.getById(session.orderId!);
  return { ring, order, intentId: handoff.intentId, sessionId: opened.id };
};

describe("partial refund", () => {
  it("records the amount and leaves the sale standing", async ({ expect }) => {
    const ctx = await setup();
    const { ring, order, intentId } = await buy(ctx);

    await ctx.payments.refund(intentId, 890, "geste commercial");

    const after = await ctx.orders.getById(order.id);
    expect(after.status).toBe("partially_refunded");
    expect(after.refundedTotal).toBe(890);

    // The customer keeps the ring, so nothing goes back on the shelf. Two of
    // three: the intake was three and one was sold.
    expect(await ctx.stock.onHand(ring.id)).toBe(2);
  });

  it("reaches refunded once the refunds cover the total", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { ring, order, intentId } = await buy(ctx);

    await ctx.payments.refund(intentId, 890);
    await ctx.payments.refund(intentId, order.total - 890);

    const after = await ctx.orders.getById(order.id);
    expect(after.status).toBe("refunded");
    expect(after.refundedTotal).toBe(order.total);

    // Now the sale is undone, so the unit comes back.
    expect(await ctx.stock.onHand(ring.id)).toBe(3);
  });

  it("ignores a redelivered refund event", async ({ expect }) => {
    const ctx = await setup();
    const { order, intentId, sessionId } = await buy(ctx);

    await ctx.payments.refund(intentId, 890);

    /*
     * The same event again, exactly as an at-least-once rail would deliver it
     * — `checkoutSessionId` included, or the listener would drop it on the
     * floor and this would prove nothing.
     *
     * The order SETS its refunded total from the rail's own sum rather than
     * adding to it, so this changes nothing; an accumulator would have read
     * 1780 here, and two more repeats would have "fully refunded" the order.
     */
    await ctx.alepha.events.emit("payments:refunded", {
      intentId,
      refundId: randomUUID(),
      amount: 890,
      refundedTotal: 890,
      currency: order.currency,
      metadata: { checkoutSessionId: sessionId },
    });

    const after = await ctx.orders.getById(order.id);
    expect(after.refundedTotal).toBe(890);
    expect(after.status).toBe("partially_refunded");
  });

  it("still lets a partially refunded order be packed and posted", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { order, intentId } = await buy(ctx);

    await ctx.payments.refund(intentId, 890);

    // A goodwill refund is a price adjustment, not a cancellation: the parcel
    // it applies to still has to go out.
    await ctx.orders.markFulfilled(order.id);
    await expect(ctx.orders.markShipped(order.id)).resolves.toMatchObject({
      status: "shipped",
    });
  });

  it("issues no credit note until the refund is complete", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { order, intentId } = await buy(ctx);

    await ctx.payments.refund(intentId, 890);

    /*
     * A credit note credits the WHOLE invoice. Issuing one for a partial
     * refund would put a document on the books saying the customer owes
     * nothing — the accounting version of the same bug.
     */
    expect(await ctx.invoices.listForOrder(order.id)).toHaveLength(1);

    await ctx.payments.refund(intentId, order.total - 890);

    const issued = await ctx.invoices.listForOrder(order.id);
    expect(issued).toHaveLength(2);
    expect(issued[1]!.creditsInvoiceId).toBe(issued[0]!.id);
  });
});
