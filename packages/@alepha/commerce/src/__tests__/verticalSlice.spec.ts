import { randomUUID } from "node:crypto";

import { $inject, $module, Alepha, z } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import type { OrderItemEntity } from "../entities/orderItems.ts";
import { AlephaCommerce } from "../index.ts";
import { ProductKindHandler } from "../interfaces/ProductKindHandler.ts";
import { ProductKindRegistry } from "../providers/ProductKindRegistry.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { StockService } from "../services/StockService.ts";

/**
 * A kind contributed from OUTSIDE the commerce package — the case that decides
 * whether the registry is a real extension point or a decoration. Nothing in
 * `@alepha/commerce` knows this exists.
 */
class GiftCardLedger {
  public readonly credited: Array<{ to: string; amount: number }> = [];
}

class GiftCardKindHandler extends ProductKindHandler {
  public readonly kind = "gift_card";
  public readonly configSchema = z.object({
    creditedCents: z.integer().min(1),
  });

  protected readonly ledger = $inject(GiftCardLedger);

  public async fulfil(item: OrderItemEntity): Promise<void> {
    const config = item.config as { creditedCents: number };
    this.ledger.credited.push({
      to: item.orderId,
      amount: config.creditedCents * item.quantity,
    });
  }
}

const GiftCardModule = $module({
  name: "test.giftcard",
  imports: [AlephaCommerce],
  services: [GiftCardLedger],
  variants: [GiftCardKindHandler],
  register: (alepha) => {
    alepha.inject(ProductKindRegistry).add(alepha.inject(GiftCardKindHandler));
  },
});

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaCommerceCheckout)
    .with(GiftCardModule);

  const catalog = alepha.inject(CatalogService);
  const carts = alepha.inject(CartService);
  const checkout = alepha.inject(CheckoutService);
  const orders = alepha.inject(OrderService);
  const stock = alepha.inject(StockService);
  const payments = alepha.inject(PaymentService);
  const ledger = alepha.inject(GiftCardLedger);

  await alepha.start();

  return { alepha, catalog, carts, checkout, orders, stock, payments, ledger };
};

const aRing = async (catalog: CatalogService, slug: string) =>
  catalog.create({
    slug,
    name: "Bague Aurore",
    price: 8900,
    published: true,
    config: { trackStock: true },
  });

describe("commerce vertical slice", () => {
  it("takes a product from catalog to paid order and decrements stock", async ({
    expect,
  }) => {
    const { catalog, carts, checkout, orders, stock, payments } = await setup();

    const ring = await aRing(catalog, `ring-${randomUUID()}`);
    await stock.recordIntake(ring.id, 3);
    expect(await stock.onHand(ring.id)).toBe(3);

    const cart = await carts.resolve(carts.newToken());
    await carts.add(cart.id, ring.id, 2);

    const priced = await carts.price(cart.id);
    expect(priced.subtotal).toBe(17800);

    const session = await checkout.start(cart.id, { email: "a@example.com" });
    expect(session.grandTotal).toBe(17800);
    // 20 % included in 178,00 € → 29,67 €
    expect(session.taxTotal).toBe(2967);

    const { handoff } = await checkout.pay(session.id, {
      returnUrl: "https://shop.example/return",
    });
    expect(handoff.mode).toBe("redirect");

    // Stock is untouched while the order is only pending.
    expect(await stock.onHand(ring.id)).toBe(3);

    // The PSP webhook lands in alepha/api/payments, which emits
    // `payments:captured` — nothing in the app calls settle() by hand.
    await payments.handleWebhookEvent(handoff.intentId, "captured");

    const settled = await checkout.getById(session.id);
    expect(settled.status).toBe("completed");
    const order = await orders.getById(settled.orderId!);
    expect(order.status).toBe("paid");
    expect(order.total).toBe(17800);
    expect(await stock.onHand(ring.id)).toBe(1);

    // The cart is emptied so a browser back-button does not re-buy it.
    expect((await carts.price(cart.id)).lines).toHaveLength(0);
  });

  it("fulfils a kind registered by another module", async ({ expect }) => {
    const { catalog, carts, checkout, orders, payments, ledger } =
      await setup();

    const card = await catalog.create({
      kind: "gift_card",
      slug: `gift-${randomUUID()}`,
      name: "Carte cadeau 50 €",
      price: 5000,
      published: true,
      config: { creditedCents: 5000 },
    });

    const cart = await carts.resolve(carts.newToken());
    await carts.add(cart.id, card.id, 1);
    const session = await checkout.start(cart.id);
    const { handoff } = await checkout.pay(session.id, {
      returnUrl: "https://shop.example/return",
    });

    expect(ledger.credited).toHaveLength(0);

    await payments.handleWebhookEvent(handoff.intentId, "captured");

    const settled = await checkout.getById(session.id);
    const order = await orders.getById(settled.orderId!);
    expect(ledger.credited).toEqual([{ to: order.id, amount: 5000 }]);
  });

  it("rejects a product whose config does not match its kind", async ({
    expect,
  }) => {
    const { catalog } = await setup();

    await expect(
      catalog.create({
        kind: "gift_card",
        slug: `bad-${randomUUID()}`,
        name: "Carte cadeau cassée",
        price: 5000,
        // `creditedCents` is required by the handler's schema.
        config: {},
      }),
    ).rejects.toThrow();
  });

  it("rejects a kind no module has registered", async ({ expect }) => {
    const { catalog } = await setup();

    await expect(
      catalog.create({
        kind: "seat",
        slug: `seat-${randomUUID()}`,
        name: "Place au balcon",
        price: 3000,
      }),
    ).rejects.toThrow(/Unknown product kind 'seat'/);
  });

  it("refuses to oversell before taking any money", async ({ expect }) => {
    const { catalog, carts, checkout, payments, stock } = await setup();

    const ring = await aRing(catalog, `scarce-${randomUUID()}`);
    await stock.recordIntake(ring.id, 1);

    const cart = await carts.resolve(carts.newToken());
    await carts.add(cart.id, ring.id, 2);
    const opened = await checkout.start(cart.id);

    // Stock is held as the order is created, so two-of-one is refused here —
    // before a payment intent exists, let alone a charge. Earlier this failed at
    // settlement instead, which meant refunding a buyer for a ring that was
    // never available.
    await expect(
      checkout.pay(opened.id, { returnUrl: "https://shop.example/return" }),
    ).rejects.toThrow(/Insufficient stock/);

    // Nothing was reserved, nothing was sold, and no intent was created.
    expect(await stock.onHand(ring.id)).toBe(1);
    expect(await stock.available(ring.id)).toBe(1);
    expect((await payments.findIntents({})).content).toHaveLength(0);

    // The checkout is still open, so the buyer can fix their basket.
    expect((await checkout.getById(opened.id)).status).toBe("open");
  });

  it("settles only once when a webhook is redelivered", async ({ expect }) => {
    const { catalog, carts, checkout, payments, stock } = await setup();

    const ring = await aRing(catalog, `idem-${randomUUID()}`);
    await stock.recordIntake(ring.id, 5);

    const cart = await carts.resolve(carts.newToken());
    await carts.add(cart.id, ring.id, 1);
    const session = await checkout.start(cart.id);
    const { handoff } = await checkout.pay(session.id, {
      returnUrl: "https://shop.example/return",
    });
    // Three identical webhook deliveries, as a flaky PSP would send them.
    await payments.handleWebhookEvent(handoff.intentId, "captured");
    await payments.handleWebhookEvent(handoff.intentId, "captured");
    await payments.handleWebhookEvent(handoff.intentId, "captured");

    expect(await stock.onHand(ring.id)).toBe(4);
  });

  it("declares what the payment rail can do instead of assuming it", async ({
    expect,
  }) => {
    const { checkout } = await setup();

    expect(checkout.capabilities()).toEqual({
      modes: ["redirect"],
      collectsShippingAddress: false,
      computesTax: false,
    });
  });
});
