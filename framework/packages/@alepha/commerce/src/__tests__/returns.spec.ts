import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { $repository, AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import { AdminOrderController } from "../admin/controllers/AdminOrderController.ts";
import { AdminReturnController } from "../admin/controllers/AdminReturnController.ts";
import { AlephaCommerceAdmin } from "../admin/index.ts";
import { CartService } from "../cart/services/CartService.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { OrderController } from "../controllers/OrderController.ts";
import { orders } from "../entities/orders.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { ReturnService } from "../services/ReturnService.ts";
import { StockService } from "../services/StockService.ts";
import { AlephaCommerceShipping } from "../shipping/index.ts";
import { ShippingService } from "../shipping/services/ShippingService.ts";

const admin = { id: randomUUID(), roles: ["admin"] };

class Ledger {
  public readonly orders = $repository(orders);
}

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmTestPostgres)
    .with(AlephaCommerceShipping)
    .with(AlephaCommerceAdmin);
  const ctx = {
    alepha,
    adminOrders: alepha.inject(AdminOrderController),
    adminReturns: alepha.inject(AdminReturnController),
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    checkout: alepha.inject(CheckoutService),
    ledger: alepha.inject(Ledger),
    orderApi: alepha.inject(OrderController),
    orders: alepha.inject(OrderService),
    payments: alepha.inject(PaymentService),
    returns: alepha.inject(ReturnService),
    shipping: alepha.inject(ShippingService),
    stock: alepha.inject(StockService),
  };
  await alepha.start();
  const zone = await ctx.shipping.createZone({
    name: "France",
    countries: ["FR"],
  });
  await ctx.shipping.createRate({
    zoneId: zone.id,
    code: `colissimo-${randomUUID()}`,
    name: "Colissimo",
    price: 690,
  });
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const aRing = async (ctx: Ctx, stock = 5) => {
  const ring = await ctx.catalog.create({
    slug: `ring-${randomUUID()}`,
    name: "Bague Aurore",
    price: 10000,
    published: true,
    config: { trackStock: true },
  });
  await ctx.stock.recordIntake(ring.id, stock);
  return ring;
};

/**
 * Two rings bought by a signed-in customer, through the real rail.
 */
const buy = async (ctx: Ctx) => {
  const ring = await aRing(ctx);
  const userId = randomUUID();
  const cart = await ctx.carts.resolve(ctx.carts.newToken(), { userId });
  await ctx.carts.add(cart.id, ring.id, 2);
  const opened = await ctx.checkout.start(cart.id, { userId });
  await ctx.checkout.setAddress(opened.id, {
    fullName: "Camille Dupont",
    line1: "12 rue des Orfèvres",
    locality: "Paris",
    postalCode: "75001",
    country: "FR",
  });
  const [option] = await ctx.checkout.shippingOptions(opened.id);
  await ctx.checkout.setShippingMethod(opened.id, option!.code);
  const { session, handoff } = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://bijoux.example/merci",
  });
  await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

  const orderId = session.orderId!;
  const [item] = await ctx.orders.itemsOf(orderId);
  return { ring, userId, orderId, item: item!, intentId: handoff.intentId };
};

const buyAndDeliver = async (ctx: Ctx) => {
  const bought = await buy(ctx);
  await ctx.orders.markShipped(bought.orderId);
  await ctx.orders.markDelivered(bought.orderId);
  return bought;
};

describe("returns", () => {
  describe("a customer's request", () => {
    it("records a return on a delivered order", async ({ expect }) => {
      const ctx = await setup();
      const { orderId, userId, item } = await buyAndDeliver(ctx);

      const { data } = await ctx.orderApi.commerceOrderReturnRequest.fetch(
        {
          params: { id: orderId },
          body: {
            lines: [{ orderItemId: item.id, quantity: 1 }],
            reason: "Trop grande",
          },
        },
        { user: { id: userId, roles: ["user"] } },
      );

      expect(data.status).toBe("requested");
      expect(data.reason).toBe("Trop grande");
      expect(data.lines).toEqual([{ orderItemId: item.id, quantity: 1 }]);
    });

    it("refuses somebody else's order", async ({ expect }) => {
      const ctx = await setup();
      const { orderId, item } = await buyAndDeliver(ctx);

      await expect(
        ctx.orderApi.commerceOrderReturnRequest.fetch(
          {
            params: { id: orderId },
            body: { lines: [{ orderItemId: item.id, quantity: 1 }] },
          },
          { user: { id: randomUUID(), roles: ["user"] } },
        ),
      ).rejects.toThrow(/does not belong to you/);
    });

    it("refuses after the withdrawal period", async ({ expect }) => {
      const ctx = await setup();
      const { orderId, item } = await buyAndDeliver(ctx);
      await ctx.ledger.orders.updateById(orderId, {
        deliveredAt: "2020-01-01T00:00:00.000Z",
      });

      await expect(
        ctx.returns.request(orderId, {
          lines: [{ orderItemId: item.id, quantity: 1 }],
        }),
      ).rejects.toThrow(/withdrawal period/);
    });

    it("counts the period from shipping when nobody marked it delivered", async ({
      expect,
    }) => {
      const ctx = await setup();
      const { orderId, item } = await buy(ctx);
      await ctx.orders.markShipped(orderId);

      const request = await ctx.returns.request(orderId, {
        lines: [{ orderItemId: item.id, quantity: 1 }],
      });

      expect(request.status).toBe("requested");
    });

    it("refuses an order that never left", async ({ expect }) => {
      const ctx = await setup();
      const { orderId, item } = await buy(ctx);

      await expect(
        ctx.returns.request(orderId, {
          lines: [{ orderItemId: item.id, quantity: 1 }],
        }),
      ).rejects.toThrow(/has not shipped/);
    });

    it("refuses more units than the order has left to return", async ({
      expect,
    }) => {
      const ctx = await setup();
      const { orderId, item } = await buyAndDeliver(ctx);
      await ctx.returns.request(orderId, {
        lines: [{ orderItemId: item.id, quantity: 1 }],
      });

      await expect(
        ctx.returns.request(orderId, {
          lines: [{ orderItemId: item.id, quantity: 2 }],
        }),
      ).rejects.toThrow(/1 left/);
    });

    it("gives units back to the count when a return is refused", async ({
      expect,
    }) => {
      const ctx = await setup();
      const { orderId, item } = await buyAndDeliver(ctx);
      const first = await ctx.returns.request(orderId, {
        lines: [{ orderItemId: item.id, quantity: 2 }],
      });
      await ctx.returns.refuse(first.id, "Hors délai");

      const second = await ctx.returns.request(orderId, {
        lines: [{ orderItemId: item.id, quantity: 2 }],
      });

      expect(second.status).toBe("requested");
    });

    it("lets a customer read their returns", async ({ expect }) => {
      const ctx = await setup();
      const { orderId, userId, item } = await buyAndDeliver(ctx);
      await ctx.returns.request(orderId, {
        lines: [{ orderItemId: item.id, quantity: 1 }],
      });

      const { data } = await ctx.orderApi.commerceOrderReturns.fetch(
        { params: { id: orderId } },
        { user: { id: userId, roles: ["user"] } },
      );

      expect(data.map((it) => it.status)).toEqual(["requested"]);
    });
  });

  describe("receiving a return", () => {
    it("restocks the lines that came back, once", async ({ expect }) => {
      const ctx = await setup();
      const { ring, orderId, item } = await buyAndDeliver(ctx);
      const request = await ctx.returns.request(orderId, {
        lines: [{ orderItemId: item.id, quantity: 1 }],
      });
      expect(await ctx.stock.onHand(ring.id)).toBe(3);

      const received = await ctx.returns.receive(request.id);

      expect(received.status).toBe("received");
      expect(await ctx.stock.onHand(ring.id)).toBe(4);
      await expect(ctx.returns.receive(request.id)).rejects.toThrow(
        /is 'received'/,
      );
      expect(await ctx.stock.onHand(ring.id)).toBe(4);
    });

    it("leaves out what came back unsellable", async ({ expect }) => {
      const ctx = await setup();
      const { ring, orderId, item } = await buyAndDeliver(ctx);
      const request = await ctx.returns.request(orderId, {
        lines: [{ orderItemId: item.id, quantity: 2 }],
      });

      await ctx.returns.receive(request.id, {
        restock: [{ orderItemId: item.id, quantity: 1 }],
      });

      expect(await ctx.stock.onHand(ring.id)).toBe(4);
    });
  });

  describe("refunding a return", () => {
    it("refunds the lines, and leaves delivery on a part of the order", async ({
      expect,
    }) => {
      const ctx = await setup();
      const { orderId, item } = await buyAndDeliver(ctx);
      const request = await ctx.returns.request(orderId, {
        lines: [{ orderItemId: item.id, quantity: 1 }],
      });
      await ctx.returns.receive(request.id);

      const { data } = await ctx.adminReturns.commerceAdminReturnRefund.fetch(
        { params: { id: request.id }, body: {} },
        { user: admin },
      );

      expect(data.status).toBe("refunded");
      const order = await ctx.orders.getById(orderId);
      expect(order.refundedTotal).toBe(10000);
      expect(order.status).toBe("partially_refunded");
    });

    it("gives everything back, delivery included, on the whole order", async ({
      expect,
    }) => {
      const ctx = await setup();
      const { orderId, item } = await buyAndDeliver(ctx);
      const request = await ctx.returns.request(orderId, {
        lines: [{ orderItemId: item.id, quantity: 2 }],
      });
      await ctx.returns.receive(request.id);

      await ctx.adminReturns.commerceAdminReturnRefund.fetch(
        { params: { id: request.id }, body: {} },
        { user: admin },
      );

      const order = await ctx.orders.getById(orderId);
      expect(order.status).toBe("refunded");
      expect(order.refundedTotal).toBe(20690);
    });

    it("refuses a return that has not come back", async ({ expect }) => {
      const ctx = await setup();
      const { orderId, item } = await buyAndDeliver(ctx);
      const request = await ctx.returns.request(orderId, {
        lines: [{ orderItemId: item.id, quantity: 1 }],
      });

      await expect(
        ctx.adminReturns.commerceAdminReturnRefund.fetch(
          { params: { id: request.id }, body: {} },
          { user: admin },
        ),
      ).rejects.toThrow(/is 'requested'/);
    });
  });

  describe("the back office", () => {
    it("lists returns by status", async ({ expect }) => {
      const ctx = await setup();
      const { orderId, item } = await buyAndDeliver(ctx);
      const request = await ctx.returns.request(orderId, {
        lines: [{ orderItemId: item.id, quantity: 1 }],
      });

      const { data } = await ctx.adminReturns.commerceAdminReturnList.fetch(
        { query: { status: "requested" } },
        { user: admin },
      );

      expect(data.content.map((it) => it.id)).toContain(request.id);
    });
  });
});

describe("cancelling lines before shipping", () => {
  it("refunds the line and puts it back on the shelf", async ({ expect }) => {
    const ctx = await setup();
    const { ring, orderId, item } = await buy(ctx);
    expect(await ctx.stock.onHand(ring.id)).toBe(3);

    const { data } = await ctx.adminOrders.commerceAdminOrderCancelLines.fetch(
      {
        params: { id: orderId },
        body: {
          lines: [{ orderItemId: item.id, quantity: 1 }],
          reason: "Erreur de saisie",
        },
      },
      { user: admin },
    );

    expect(data.status).toBe("partially_refunded");
    expect(data.refundedTotal).toBe(10000);
    expect(await ctx.stock.onHand(ring.id)).toBe(4);
    const [after] = await ctx.orders.itemsOf(orderId);
    expect(after!.cancelledQuantity).toBe(1);
  });

  it("cancels the last line without restocking twice", async ({ expect }) => {
    const ctx = await setup();
    const { ring, orderId, item } = await buy(ctx);

    await ctx.adminOrders.commerceAdminOrderCancelLines.fetch(
      {
        params: { id: orderId },
        body: { lines: [{ orderItemId: item.id, quantity: 2 }] },
      },
      { user: admin },
    );

    expect(await ctx.stock.onHand(ring.id)).toBe(5);
  });

  it("refuses once the parcel has left", async ({ expect }) => {
    const ctx = await setup();
    const { orderId, item } = await buy(ctx);
    await ctx.orders.markShipped(orderId);

    await expect(
      ctx.adminOrders.commerceAdminOrderCancelLines.fetch(
        {
          params: { id: orderId },
          body: { lines: [{ orderItemId: item.id, quantity: 1 }] },
        },
        { user: admin },
      ),
    ).rejects.toThrow(/has shipped/);
  });
});
