import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import type { UserAccountToken } from "alepha/security";
import { describe, it } from "vitest";

import { AdminOrderController } from "../admin/controllers/AdminOrderController.ts";
import { AdminProductController } from "../admin/controllers/AdminProductController.ts";
import { AlephaCommerceAdmin } from "../admin/index.ts";
import { CartService } from "../cart/services/CartService.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { StockService } from "../services/StockService.ts";

const admin: UserAccountToken = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Camille (admin)",
  roles: ["admin"],
};

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaCommerceCheckout)
    .with(AlephaCommerceAdmin);

  const ctx = {
    alepha,
    products: alepha.inject(AdminProductController),
    ordersCtrl: alepha.inject(AdminOrderController),
    catalog: alepha.inject(CatalogService),
    carts: alepha.inject(CartService),
    checkout: alepha.inject(CheckoutService),
    orders: alepha.inject(OrderService),
    stock: alepha.inject(StockService),
    payments: alepha.inject(PaymentService),
  };
  await alepha.start();
  return ctx;
};

const buy = async (
  ctx: Awaited<ReturnType<typeof setup>>,
  productId: string,
) => {
  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  await ctx.carts.add(cart.id, productId, 1);
  const opened = await ctx.checkout.start(cart.id);
  const { session, handoff } = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://bijoux.example/merci",
  });
  await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
  return session.orderId!;
};

describe("admin catalog", () => {
  it("lists drafts, which the public catalog hides", async ({ expect }) => {
    const ctx = await setup();
    const slug = `draft-${randomUUID()}`;
    await ctx.catalog.create({
      slug,
      name: "Pièce en préparation",
      price: 12000,
      published: false,
    });

    expect((await ctx.catalog.list()).content).toHaveLength(0);

    const page = await ctx.products.commerceAdminProductList(
      { query: {} },
      { user: admin },
    );
    expect(page.content.map((p) => p.slug)).toContain(slug);
  });

  it("reports available stock apart from reserved", async ({ expect }) => {
    const ctx = await setup();
    const ring = await ctx.catalog.create({
      slug: `ring-${randomUUID()}`,
      name: "Bague Aurore",
      price: 8900,
      published: true,
      config: { trackStock: true },
    });
    await ctx.stock.recordIntake(ring.id, 3);

    // One unit is in somebody's checkout.
    const cart = await ctx.carts.resolve(ctx.carts.newToken());
    await ctx.carts.add(cart.id, ring.id, 1);
    const opened = await ctx.checkout.start(cart.id);
    await ctx.checkout.pay(opened.id, {
      returnUrl: "https://bijoux.example/merci",
    });

    const page = await ctx.products.commerceAdminProductList(
      { query: {} },
      { user: admin },
    );
    const row = page.content.find((p) => p.id === ring.id)!;

    // Three are in the drawer, one is spoken for, two are sellable — showing
    // only "3" is what makes a restock decision wrong.
    expect(row.onHand).toBe(3);
    expect(row.reserved).toBe(1);
    expect(row.available).toBe(2);
  });

  it("offers every registered kind to a product form", async ({ expect }) => {
    const ctx = await setup();
    const { kinds } = await ctx.products.commerceAdminProductKinds(
      {},
      { user: admin },
    );
    expect(kinds).toEqual(["digital", "good"]);
  });

  it("records a restock and reports the new figure", async ({ expect }) => {
    const ctx = await setup();
    const ring = await ctx.catalog.create({
      slug: `ring-${randomUUID()}`,
      name: "Bague Aurore",
      price: 8900,
      published: true,
    });

    const result = await ctx.products.commerceAdminProductRestock(
      { params: { id: ring.id }, body: { quantity: 4, note: "Livraison" } },
      { user: admin },
    );
    expect(result.onHand).toBe(4);
  });

  it("rejects a product whose config does not fit its kind", async ({
    expect,
  }) => {
    const ctx = await setup();
    await expect(
      ctx.products.commerceAdminProductCreate(
        {
          body: {
            kind: "digital",
            slug: `bad-${randomUUID()}`,
            name: "Sans lien",
            price: 500,
            config: {},
          },
        },
        { user: admin },
      ),
    ).rejects.toThrow();
  });
});

describe("admin orders", () => {
  it("ships an order and records the tracking number", async ({ expect }) => {
    const ctx = await setup();
    const ring = await ctx.catalog.create({
      slug: `ring-${randomUUID()}`,
      name: "Bague Aurore",
      price: 8900,
      published: true,
      config: { trackStock: true },
    });
    await ctx.stock.recordIntake(ring.id, 2);
    const orderId = await buy(ctx, ring.id);

    const shipped = await ctx.ordersCtrl.commerceAdminOrderShip(
      {
        params: { id: orderId },
        body: { trackingNumber: "6A12345678901" },
      },
      { user: admin },
    );

    expect(shipped.status).toBe("shipped");
    expect(shipped.trackingNumber).toBe("6A12345678901");
  });

  it("refunds through the payment rail and then the domain", async ({
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
    const orderId = await buy(ctx, ring.id);
    expect(await ctx.stock.onHand(ring.id)).toBe(1);

    const refunded = await ctx.ordersCtrl.commerceAdminOrderRefund(
      { params: { id: orderId }, body: { reason: "Ne convient pas" } },
      { user: admin },
    );

    expect(refunded.status).toBe("refunded");
    // The stock came back...
    expect(await ctx.stock.onHand(ring.id)).toBe(2);
    // ...and the money was actually returned, not just the record changed.
    const order = await ctx.orders.getById(orderId);
    const intent = await ctx.payments.getIntent(order.paymentIntentId!);
    expect(intent.status).toBe("refunded");
  });

  it("leaves the order untouched when the payment rail refuses", async ({
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
    const orderId = await buy(ctx, ring.id);

    // Refund it once, so the second attempt is refused by the rail.
    await ctx.ordersCtrl.commerceAdminOrderRefund(
      { params: { id: orderId }, body: {} },
      { user: admin },
    );
    const onHandAfterFirst = await ctx.stock.onHand(ring.id);

    await expect(
      ctx.ordersCtrl.commerceAdminOrderRefund(
        { params: { id: orderId }, body: {} },
        {
          user: admin,
        },
      ),
    ).rejects.toThrow();

    // No second restock: the domain never ran because the rail said no.
    expect(await ctx.stock.onHand(ring.id)).toBe(onHandAfterFirst);
  });

  it("filters by status", async ({ expect }) => {
    const ctx = await setup();
    const ring = await ctx.catalog.create({
      slug: `ring-${randomUUID()}`,
      name: "Bague Aurore",
      price: 8900,
      published: true,
    });
    await ctx.stock.recordIntake(ring.id, 5);

    await ctx.orders.create({
      status: "paid",
      lines: [{ productId: ring.id, quantity: 1 }],
    });
    const pending = await ctx.orders.create({
      status: "pending",
      lines: [{ productId: ring.id, quantity: 1 }],
    });

    const page = await ctx.ordersCtrl.commerceAdminOrderList(
      { query: { status: "pending" } },
      { user: admin },
    );
    expect(page.content.map((o) => o.id)).toEqual([pending.id]);
  });

  it("returns an order with its lines", async ({ expect }) => {
    const ctx = await setup();
    const ring = await ctx.catalog.create({
      slug: `ring-${randomUUID()}`,
      name: "Bague Aurore",
      price: 8900,
      published: true,
      config: { trackStock: true },
    });
    await ctx.stock.recordIntake(ring.id, 2);
    const orderId = await buy(ctx, ring.id);

    const { order, items } = await ctx.ordersCtrl.commerceAdminOrderDetail(
      { params: { id: orderId } },
      { user: admin },
    );

    expect(order.id).toBe(orderId);
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("Bague Aurore");
  });
});
