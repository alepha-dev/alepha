import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { MemoryEmailProvider } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";
import { CartService } from "../cart/services/CartService.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { AlephaCommerceNotifications } from "../notifications/index.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { StockService } from "../services/StockService.ts";

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaCommerceNotifications);

  const ctx = {
    alepha,
    catalog: alepha.inject(CatalogService),
    carts: alepha.inject(CartService),
    checkout: alepha.inject(CheckoutService),
    orders: alepha.inject(OrderService),
    stock: alepha.inject(StockService),
    payments: alepha.inject(PaymentService),
    mail: alepha.inject(MemoryEmailProvider),
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

/** Buy one, with an email on the checkout so the mailer has a recipient. */
const buy = async (
  ctx: Awaited<ReturnType<typeof setup>>,
  productId: string,
  email = "camille@example.com",
) => {
  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  await ctx.carts.add(cart.id, productId, 1);
  const opened = await ctx.checkout.start(cart.id, { email });
  const { session, handoff } = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://bijoux.example/merci",
  });
  await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
  return session.orderId!;
};

describe("order lifecycle", () => {
  it("walks paid → fulfilled → shipped → delivered", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);
    const orderId = await buy(ctx, ring.id);

    expect((await ctx.orders.getById(orderId)).status).toBe("paid");

    await ctx.orders.markFulfilled(orderId);
    expect((await ctx.orders.getById(orderId)).status).toBe("fulfilled");

    const shipped = await ctx.orders.markShipped(orderId, {
      trackingNumber: "6A12345678901",
      trackingUrl: "https://laposte.fr/suivi/6A12345678901",
    });
    expect(shipped.status).toBe("shipped");
    expect(shipped.trackingNumber).toBe("6A12345678901");
    expect(shipped.shippedAt).toBeTruthy();

    const delivered = await ctx.orders.markDelivered(orderId);
    expect(delivered.status).toBe("delivered");
    expect(delivered.deliveredAt).toBeTruthy();
  });

  it("allows paid → shipped without the fulfilment step", async ({
    expect,
  }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);
    const orderId = await buy(ctx, ring.id);

    await expect(ctx.orders.markShipped(orderId)).resolves.toMatchObject({
      status: "shipped",
    });
  });

  it("refuses to ship an order that is not paid", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);

    const pending = await ctx.orders.create({
      status: "pending",
      lines: [{ productId: ring.id, quantity: 1 }],
    });

    await expect(ctx.orders.markShipped(pending.id)).rejects.toThrow(
      /it is 'pending', expected one of paid, fulfilled/,
    );
  });

  it("refuses to ship a refunded order", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);
    const orderId = await buy(ctx, ring.id);

    await ctx.orders.refund(orderId);

    // Without this guard an admin double-click would email a tracking number
    // for a parcel nobody is sending.
    await expect(ctx.orders.markShipped(orderId)).rejects.toThrow(
      /it is 'refunded'/,
    );
  });

  it("refuses to mark delivered before shipping", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);
    const orderId = await buy(ctx, ring.id);

    await expect(ctx.orders.markDelivered(orderId)).rejects.toThrow(
      /expected one of shipped/,
    );
  });

  it("puts the stock back on refund", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 3);
    const orderId = await buy(ctx, ring.id);

    expect(await ctx.stock.onHand(ring.id)).toBe(2);
    await ctx.orders.refund(orderId);
    expect(await ctx.stock.onHand(ring.id)).toBe(3);
  });

  it("lists a customer's own orders, newest first", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 5);
    const userId = randomUUID();

    const first = await ctx.orders.create({
      userId,
      status: "paid",
      lines: [{ productId: ring.id, quantity: 1 }],
    });
    const second = await ctx.orders.create({
      userId,
      status: "paid",
      lines: [{ productId: ring.id, quantity: 1 }],
    });
    // Someone else's order must not appear.
    await ctx.orders.create({
      userId: randomUUID(),
      status: "paid",
      lines: [{ productId: ring.id, quantity: 1 }],
    });

    const page = await ctx.orders.listForUser(userId);
    expect(page.content.map((o) => o.id)).toEqual([second.id, first.id]);
  });

  it("filters the back-office listing by status", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 5);

    await ctx.orders.create({
      status: "paid",
      lines: [{ productId: ring.id, quantity: 1 }],
    });
    const pending = await ctx.orders.create({
      status: "pending",
      lines: [{ productId: ring.id, quantity: 1 }],
    });

    const page = await ctx.orders.list({ status: "pending" });
    expect(page.content.map((o) => o.id)).toEqual([pending.id]);
    // No filter returns everything.
    expect((await ctx.orders.list()).content.length).toBe(2);
  });
});

describe("order emails", () => {
  it("sends a confirmation when the order is paid", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);

    await buy(ctx, ring.id, "camille@example.com");

    const sent = ctx.mail.records;
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("camille@example.com");
    expect(sent[0]!.subject).toContain("confirmée");
    expect(sent[0]!.body).toContain("Bague Aurore");
    expect(sent[0]!.body).toContain("89.00 EUR");
    // The statutory withdrawal notice belongs on the confirmation.
    expect(sent[0]!.body).toContain("rétractation");
  });

  it("sends a shipping notice with the tracking number", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);
    const orderId = await buy(ctx, ring.id);

    await ctx.orders.markShipped(orderId, {
      trackingNumber: "6A12345678901",
      trackingUrl: "https://laposte.fr/suivi/6A12345678901",
    });

    const notice = ctx.mail.records.at(-1)!;
    expect(notice.subject).toContain("en route");
    expect(notice.body).toContain("6A12345678901");
    expect(notice.body).toContain("Suivre mon colis");
  });

  it("sends nothing when there is no email on file", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);

    // A counter sale: no checkout, so no address to write to.
    const order = await ctx.orders.create({
      status: "paid",
      lines: [{ productId: ring.id, quantity: 1 }],
    });
    await ctx.orders.markShipped(order.id);

    expect(ctx.mail.records).toHaveLength(0);
  });

  it("does not resend on a redelivered webhook", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 3);

    const cart = await ctx.carts.resolve(ctx.carts.newToken());
    await ctx.carts.add(cart.id, ring.id, 1);
    const opened = await ctx.checkout.start(cart.id, {
      email: "camille@example.com",
    });
    const { handoff } = await ctx.checkout.pay(opened.id, {
      returnUrl: "https://bijoux.example/merci",
    });

    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

    expect(ctx.mail.records).toHaveLength(1);
  });
});
