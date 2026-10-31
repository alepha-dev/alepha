import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { StockService } from "../services/StockService.ts";

/**
 * Two callers driving one order at once.
 *
 * Every transition used to read the status, check it, and write: two settles
 * that overlap both read `pending`, and the second sold the stock again once
 * the first let go of the lock. Duplicate webhooks do not get here (the intent
 * moves with a guarded update), but the reconciliation job does, and so does
 * any application code calling a `settle()` documented as idempotent.
 */
const setup = async (backend: "postgres" | "sqlite") => {
  const alepha =
    backend === "postgres"
      ? Alepha.create().with(AlephaOrmPostgres).with(AlephaCommerceCheckout)
      : Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }).with(
          AlephaCommerceCheckout,
        );
  const ctx = {
    alepha,
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    checkout: alepha.inject(CheckoutService),
    orders: alepha.inject(OrderService),
    payments: alepha.inject(PaymentService),
    stock: alepha.inject(StockService),
  };
  await alepha.start();
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

/**
 * A ring taken to the payment page: session `paying`, order `pending`.
 */
const reachPayment = async (ctx: Ctx) => {
  const ring = await ctx.catalog.create({
    slug: `ring-${randomUUID()}`,
    name: "Bague Aurore",
    price: 8900,
    published: true,
    config: { trackStock: true },
  });
  await ctx.stock.recordIntake(ring.id, 3);

  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  await ctx.carts.add(cart.id, ring.id, 1);
  const opened = await ctx.checkout.start(cart.id);
  const { session } = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://bijoux.example/merci",
  });
  return { ring, sessionId: opened.id, orderId: session.orderId! };
};

const reachPaid = async (ctx: Ctx) => {
  const reached = await reachPayment(ctx);
  await ctx.checkout.settle(reached.sessionId);
  return reached;
};

describe("order transitions", () => {
  describe.each(["postgres", "sqlite"] as const)("on %s", (backend) => {
    describe("two settles at once", () => {
      it("sells the stock once and emits paid once", async ({ expect }) => {
        const ctx = await setup(backend);
        const { ring, sessionId, orderId } = await reachPayment(ctx);
        const paid: string[] = [];
        ctx.alepha.events.on("commerce:order:paid", (event) => {
          paid.push(event.orderId);
        });

        await Promise.all([
          ctx.checkout.settle(sessionId),
          ctx.checkout.settle(sessionId),
        ]);

        expect(await ctx.stock.onHand(ring.id)).toBe(2);
        expect(paid).toEqual([orderId]);
        expect((await ctx.orders.getById(orderId)).status).toBe("paid");
      });
    });

    describe("two refunds at once", () => {
      it("restocks once and emits refunded once", async ({ expect }) => {
        const ctx = await setup(backend);
        const { ring, orderId } = await reachPaid(ctx);
        const refunded: number[] = [];
        ctx.alepha.events.on("commerce:order:refunded", (event) => {
          refunded.push(event.amount);
        });

        await Promise.all([
          ctx.orders.refund(orderId),
          ctx.orders.refund(orderId),
        ]);

        expect(await ctx.stock.onHand(ring.id)).toBe(3);
        expect(refunded).toEqual([8900]);
      });
    });

    describe("two ships at once", () => {
      it("lets one through, and emits shipped once", async ({ expect }) => {
        const ctx = await setup(backend);
        const { orderId } = await reachPaid(ctx);
        const shipped: string[] = [];
        ctx.alepha.events.on("commerce:order:shipped", (event) => {
          shipped.push(event.orderId);
        });

        const outcomes = await Promise.allSettled([
          ctx.orders.markShipped(orderId),
          ctx.orders.markShipped(orderId),
        ]);

        expect(outcomes.filter((it) => it.status === "fulfilled")).toHaveLength(
          1,
        );
        expect(shipped).toEqual([orderId]);
      });
    });

    describe("a settle racing a cancel", () => {
      it("never leaves a captured order cancelled with a completed session", async ({
        expect,
      }) => {
        const ctx = await setup(backend);
        const { ring, sessionId, orderId } = await reachPayment(ctx);
        const strays: string[] = [];
        ctx.alepha.events.on("commerce:capture:strayDetected", (event) => {
          strays.push(event.orderId);
        });

        await Promise.allSettled([
          ctx.checkout.settle(sessionId),
          ctx.orders.cancel(orderId),
        ]);

        const order = await ctx.orders.getById(orderId);
        const session = await ctx.checkout.getById(sessionId);
        if (order.status === "paid") {
          expect(session.status).toBe("completed");
          expect(await ctx.stock.onHand(ring.id)).toBe(2);
          expect(strays).toEqual([]);
        } else {
          expect(order.status).toBe("cancelled");
          expect(session.status).not.toBe("completed");
          expect(await ctx.stock.onHand(ring.id)).toBe(3);
          expect(strays).toEqual([orderId]);
        }
      });
    });
  });
});

describe("the stock ledger, order by order", () => {
  describe.each(["postgres", "sqlite"] as const)("on %s", (backend) => {
    describe("recordSale", () => {
      it("sells a line once, however often it is delivered", async ({
        expect,
      }) => {
        const ctx = await setup(backend);
        const { ring } = await reachPayment(ctx);
        const orderId = randomUUID();
        const orderItemId = randomUUID();

        await ctx.stock.recordSale(ring.id, 1, { orderId, orderItemId });
        await ctx.stock.recordSale(ring.id, 1, { orderId, orderItemId });

        expect(await ctx.stock.onHand(ring.id)).toBe(2);
      });

      it("sells two lines of one product twice", async ({ expect }) => {
        const ctx = await setup(backend);
        const { ring } = await reachPayment(ctx);
        const orderId = randomUUID();

        await ctx.stock.recordSale(ring.id, 1, {
          orderId,
          orderItemId: randomUUID(),
        });
        await ctx.stock.recordSale(ring.id, 1, {
          orderId,
          orderItemId: randomUUID(),
        });

        expect(await ctx.stock.onHand(ring.id)).toBe(1);
      });

      it("sells again once the sale was given back", async ({ expect }) => {
        const ctx = await setup(backend);
        const { ring } = await reachPayment(ctx);
        const orderId = randomUUID();
        const orderItemId = randomUUID();

        await ctx.stock.recordSale(ring.id, 1, { orderId, orderItemId });
        await ctx.stock.releaseOrder(orderId);
        await ctx.stock.recordSale(ring.id, 1, { orderId, orderItemId });

        expect(await ctx.stock.onHand(ring.id)).toBe(2);
      });
    });

    describe("releaseOrder", () => {
      it("gives a sale back once, however often it runs", async ({
        expect,
      }) => {
        const ctx = await setup(backend);
        const { ring, orderId } = await reachPaid(ctx);

        await ctx.stock.releaseOrder(orderId);
        await ctx.stock.releaseOrder(orderId);

        expect(await ctx.stock.onHand(ring.id)).toBe(3);
      });
    });
  });
});
