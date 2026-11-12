import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { CheckoutController } from "../checkout/controllers/CheckoutController.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { OrderController } from "../controllers/OrderController.ts";
import { CatalogService } from "../services/CatalogService.ts";

const fileId = randomUUID();

/**
 * A product's `config` is the merchant's: for a digital product it holds the
 * file itself. It is snapshotted onto every order line, and the customer's
 * order views used to answer that line in full, whatever the order's status,
 * so a buyer who called `pay()` and never paid read the file.
 */
const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmTestPostgres)
    .with(AlephaCommerceCheckout);
  const ctx = {
    alepha,
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    checkout: alepha.inject(CheckoutService),
    checkoutApi: alepha.inject(CheckoutController),
    orderApi: alepha.inject(OrderController),
  };
  await alepha.start();
  return ctx;
};

/**
 * Checkout reaches `pay()` and stops there: an order `pending`, no money.
 */
const reachPayment = async (
  ctx: Awaited<ReturnType<typeof setup>>,
  userId?: string,
) => {
  const pattern = await ctx.catalog.create({
    kind: "digital",
    slug: `pattern-${randomUUID()}`,
    name: "Patron de robe",
    price: 1200,
    published: true,
    config: { fileId },
  });
  const cart = await ctx.carts.resolve(ctx.carts.newToken(), { userId });
  await ctx.carts.add(cart.id, pattern.id, 1);
  const opened = await ctx.checkout.start(cart.id, { userId });
  const { session } = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://patrons.example/merci",
  });
  return { sessionId: opened.id, orderId: session.orderId! };
};

describe("a pending digital order", () => {
  describe("commerceCheckoutOrder", () => {
    it("carries no file over HTTP", async ({ expect }) => {
      const ctx = await setup();
      const { sessionId } = await reachPayment(ctx);

      const { data } = await ctx.checkoutApi.commerceCheckoutOrder.fetch({
        params: { id: sessionId },
      });

      expect(data.items).toHaveLength(1);
      expect(JSON.stringify(data)).not.toContain(fileId);
    });

    it("carries no file to a server-side loader", async ({ expect }) => {
      const ctx = await setup();
      const { sessionId } = await reachPayment(ctx);

      const data = await ctx.checkoutApi.commerceCheckoutOrder.run({
        params: { id: sessionId },
      });

      expect(JSON.stringify(data)).not.toContain(fileId);
    });
  });

  describe("commerceOrderDetail", () => {
    it("carries no file", async ({ expect }) => {
      const ctx = await setup();
      const userId = randomUUID();
      const { orderId } = await reachPayment(ctx, userId);

      const { data } = await ctx.orderApi.commerceOrderDetail.fetch(
        { params: { id: orderId } },
        { user: { id: userId, roles: ["user"] } },
      );

      expect(data.items).toHaveLength(1);
      expect(JSON.stringify(data)).not.toContain(fileId);
    });
  });
});
