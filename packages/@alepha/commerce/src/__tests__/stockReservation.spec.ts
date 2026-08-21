import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { StockService } from "../services/StockService.ts";

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaCommerceCheckout);
  const ctx = {
    alepha,
    catalog: alepha.inject(CatalogService),
    carts: alepha.inject(CartService),
    checkout: alepha.inject(CheckoutService),
    orders: alepha.inject(OrderService),
    stock: alepha.inject(StockService),
    payments: alepha.inject(PaymentService),
    dateTime: alepha.inject(DateTimeProvider),
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

/** Take a cart to the payment page, returning the intent to settle or fail. */
const reachPayment = async (
  ctx: Awaited<ReturnType<typeof setup>>,
  productId: string,
  quantity = 1,
) => {
  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  await ctx.carts.add(cart.id, productId, quantity);
  const opened = await ctx.checkout.start(cart.id);
  const { session, handoff } = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://bijoux.example/merci",
  });
  return { session, handoff };
};

describe("stock reservation", () => {
  it("distinguishes on-hand, reserved and available", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 3);

    await reachPayment(ctx, ring.id, 2);

    // Nothing has left the drawer...
    expect(await ctx.stock.onHand(ring.id)).toBe(3);
    // ...but two units are spoken for...
    expect(await ctx.stock.reserved(ring.id)).toBe(2);
    // ...so only one may still be sold.
    expect(await ctx.stock.available(ring.id)).toBe(1);
  });

  it("stops the second buyer from reaching payment for the last one", async ({
    expect,
  }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 1);

    // First buyer holds it.
    await reachPayment(ctx, ring.id, 1);

    // Second buyer is refused at the checkout, not after paying.
    await expect(reachPayment(ctx, ring.id, 1)).rejects.toThrow(
      /Insufficient stock/,
    );
  });

  it("consumes the hold when the payment settles", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 3);

    const { handoff } = await reachPayment(ctx, ring.id, 2);
    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

    expect(await ctx.stock.onHand(ring.id)).toBe(1);
    // The hold is gone — it must not be counted twice.
    expect(await ctx.stock.reserved(ring.id)).toBe(0);
    expect(await ctx.stock.available(ring.id)).toBe(1);
  });

  it("gives the stock back the moment the payment fails", async ({
    expect,
  }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 1);

    const { session, handoff } = await reachPayment(ctx, ring.id, 1);
    expect(await ctx.stock.available(ring.id)).toBe(0);

    await ctx.payments.handleWebhookEvent(handoff.intentId, "failed");

    // Released at once, not five minutes later when the sweep runs.
    expect(await ctx.stock.available(ring.id)).toBe(1);
    expect((await ctx.checkout.getById(session.id)).status).toBe("abandoned");
    expect((await ctx.orders.getById(session.orderId!)).status).toBe(
      "cancelled",
    );
  });

  it("expires a hold on its own, before any sweep runs", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 1);

    await reachPayment(ctx, ring.id, 1);
    expect(await ctx.stock.available(ring.id)).toBe(0);

    // Walk past the TTL. Nothing has swept; availability alone must recover.
    await ctx.dateTime.travel(
      StockService.RESERVATION_TTL_MINUTES + 1,
      "minutes",
    );

    expect(await ctx.stock.available(ring.id)).toBe(1);
  });

  it("the sweep marks expired holds released", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 1);

    const { session } = await reachPayment(ctx, ring.id, 1);
    await ctx.dateTime.travel(
      StockService.RESERVATION_TTL_MINUTES + 1,
      "minutes",
    );

    /*
     * Sweep, but do not assert how many *this* call released.
     *
     * `AlephaCommerceCheckout` registers `StockReservationSweeper`, whose `$job`
     * runs the very same method every five minutes. `CronProvider` schedules
     * with `dateTime.wait()`, so the travel above — 31 minutes, six cron
     * boundaries — fires that job rather than waiting out real time. Whether its
     * handler lands before or after the line below is a race decided by machine
     * load: the count was 1 when the spec ran alone and 0 under a loaded
     * `yarn v` or CI, a flake that says nothing about the sweep.
     *
     * What matters is the end state, and that is the same whichever caller got
     * there first.
     */
    await ctx.stock.releaseExpiredReservations();

    const holds = await ctx.stock.reservationsOf(session.orderId!);
    expect(holds.map((h) => h.status)).toEqual(["released"]);

    // Running it again finds nothing — the sweep is idempotent. Deterministic
    // whoever swept first, because by now there is nothing left to release.
    expect(await ctx.stock.releaseExpiredReservations()).toBe(0);
  });

  it("does not hold anything for a kind that consumes nothing", async ({
    expect,
  }) => {
    const ctx = await setup();
    const download = await ctx.catalog.create({
      kind: "digital",
      slug: `pdf-${randomUUID()}`,
      name: "Guide d'entretien",
      price: 500,
      published: true,
      config: { downloadUrl: "https://example.invalid/guide.pdf" },
    });

    const { session } = await reachPayment(ctx, download.id, 1);
    expect(await ctx.stock.reservationsOf(session.orderId!)).toEqual([]);
  });

  it("does not hold anything for an untracked good", async ({ expect }) => {
    const ctx = await setup();
    const madeToOrder = await ctx.catalog.create({
      slug: `custom-${randomUUID()}`,
      name: "Pièce sur mesure",
      price: 45000,
      published: true,
      config: { trackStock: false },
    });

    const { session } = await reachPayment(ctx, madeToOrder.id, 1);
    expect(await ctx.stock.reservationsOf(session.orderId!)).toEqual([]);
  });

  it("a counter sale skips the hold and sells straight away", async ({
    expect,
  }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);

    const order = await ctx.orders.create({
      status: "paid",
      lines: [{ productId: ring.id, quantity: 1 }],
    });

    expect(order.status).toBe("paid");
    expect(await ctx.stock.onHand(ring.id)).toBe(1);
    expect(await ctx.stock.reservationsOf(order.id)).toEqual([]);
  });

  it("a redelivered webhook does not decrement twice", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 5);

    const { handoff } = await reachPayment(ctx, ring.id, 1);
    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

    expect(await ctx.stock.onHand(ring.id)).toBe(4);
  });
});
