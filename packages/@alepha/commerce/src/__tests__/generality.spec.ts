import { randomUUID } from "node:crypto";

import { Alepha, z } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { DatabaseProvider } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import type { OrderItemEntity } from "../entities/orderItems.ts";
import type { ProductEntity } from "../entities/products.ts";
import { InvalidLineError } from "../errors/CommerceError.ts";
import { ResourceKindHandler } from "../kinds/ResourceKindHandler.ts";
import { ProductKindRegistry } from "../providers/ProductKindRegistry.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { ResourceService } from "../services/ResourceService.ts";
import { StockService } from "../services/StockService.ts";
import { TestCourtKind } from "./fixtures/TestCourtKind.ts";

interface Timetable {
  train: string;
  capacity: number;
  stops: Array<{ station: string; at: string }>;
}

/**
 * A seat on a train, sold from one station to another: an origin-destination
 * sale. The legs are the resources, one per pair of consecutive stops, and a
 * seat from A to C over a train running A to B to C claims one place on both.
 *
 * Nothing in commerce knows what a train is. If this kind needed a special
 * case anywhere in `ResourceService`, `ResourceKindHandler`, `OrderService`
 * or the cart, the primitive would not be right.
 */
class TestSeatKind extends ResourceKindHandler {
  public readonly kind = "test-seat";
  public readonly configSchema = z.object({
    train: z.text(),
    capacity: z.integer(),
    stops: z.array(z.object({ station: z.text(), at: z.text() })),
  });
  public readonly lineSchema = z.object({ from: z.text(), to: z.text() });

  public async validateLine(
    product: ProductEntity,
    line: Record<string, any>,
  ): Promise<void> {
    const stations = (product.config as Timetable).stops.map((s) => s.station);
    const [from, to] = [stations.indexOf(line.from), stations.indexOf(line.to)];
    if (from < 0 || to < 0 || from >= to) {
      throw new InvalidLineError(
        `This train does not run from ${line.from} to ${line.to}.`,
      );
    }
  }

  public resolve(item: OrderItemEntity) {
    const { train, capacity, stops } = item.config as Timetable;
    const line = item.lineConfig as { from: string; to: string };
    const from = stops.findIndex((s) => s.station === line.from);
    const to = stops.findIndex((s) => s.station === line.to);
    return stops.slice(from, to).map((stop, index) => ({
      resourceId: `${train}:${stop.station}-${stops[from + index + 1]!.station}`,
      startsAt: stop.at,
      endsAt: stops[from + index + 1]!.at,
      capacity,
    }));
  }
}

/**
 * `d1` is SQLite with its transactions switched off, the flag and the method
 * both: what D1 is. There nothing serialises two orders and nothing rolls a
 * lost order back, so a racer can land between an order's two claims and the
 * handler alone must give the first one back.
 */
const setup = async (backend: "postgres" | "sqlite" | "d1") => {
  const alepha =
    backend === "postgres"
      ? Alepha.create().with(AlephaOrmPostgres).with(AlephaCommerceCheckout)
      : Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }).with(
          AlephaCommerceCheckout,
        );
  const kinds = alepha.inject(ProductKindRegistry);
  kinds.add(alepha.inject(TestSeatKind));
  kinds.add(alepha.inject(TestCourtKind));
  const ctx = {
    alepha,
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    checkout: alepha.inject(CheckoutService),
    orders: alepha.inject(OrderService),
    payments: alepha.inject(PaymentService),
    resources: alepha.inject(ResourceService),
    stock: alepha.inject(StockService),
  };
  await alepha.start();
  if (backend === "d1") {
    const db = alepha.inject(DatabaseProvider);
    Object.defineProperty(db, "supportsTransactions", { get: () => false });
    Object.defineProperty(db, "transactional", {
      value: <R>(fn: () => Promise<R>) => fn(),
    });
  }
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const at = (hhmm: string) => `2030-01-05T${hhmm}:00.000Z`;

/**
 * A train running Lyon, Dijon, Paris, with `capacity` seats on every leg.
 */
const aTrain = (ctx: Ctx, capacity = 1) => {
  const train = `tgv-${randomUUID()}`;
  return ctx.catalog.create({
    kind: "test-seat",
    slug: train,
    name: "TGV 6602",
    price: 4900,
    published: true,
    config: {
      train,
      capacity,
      stops: [
        { station: "lyon", at: at("08:00") },
        { station: "dijon", at: at("09:30") },
        { station: "paris", at: at("11:00") },
      ],
    },
  });
};

const legsOf = (train: ProductEntity) => {
  const id = (train.config as Timetable).train;
  return { first: `${id}:lyon-dijon`, second: `${id}:dijon-paris` };
};

/**
 * Through the real cart and the real checkout, to the payment page.
 */
const reachPayment = async (
  ctx: Ctx,
  lines: Array<{ productId: string; lineConfig?: Record<string, any> }>,
) => {
  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  for (const line of lines) {
    await ctx.carts.add(cart.id, line.productId, 1, line.lineConfig);
  }
  const opened = await ctx.checkout.start(cart.id);
  const { session, handoff } = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://rail.example/merci",
  });
  return { orderId: session.orderId!, handoff };
};

/**
 * The claims an order still holds or has bought.
 */
const liveClaims = async (ctx: Ctx, orderId: string) =>
  (await ctx.resources.claimsOf(orderId)).filter(
    (it) => it.status !== "released",
  );

describe("one item, two legs, one sale", () => {
  describe.each(["postgres", "sqlite"] as const)("on %s", (backend) => {
    it("sells a seat over two legs as one line, one price and two claims", async ({
      expect,
    }) => {
      const ctx = await setup(backend);
      const train = await aTrain(ctx);
      const { first, second } = legsOf(train);

      const { orderId, handoff } = await reachPayment(ctx, [
        { productId: train.id, lineConfig: { from: "lyon", to: "paris" } },
      ]);

      const [item, ...others] = await ctx.orders.itemsOf(orderId);
      expect(others).toEqual([]);
      expect(item).toMatchObject({ unitPrice: 4900, quantity: 1 });
      expect((await ctx.orders.getById(orderId)).total).toBe(4900);

      await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

      const claims = await ctx.resources.claimsOf(orderId);
      expect(
        Object.fromEntries(
          claims.map((it) => [it.resourceId, [it.status, it.orderItemId]]),
        ),
      ).toEqual({
        [first]: ["consumed", item!.id],
        [second]: ["consumed", item!.id],
      });

      // Both legs are full now: Dijon to Paris cannot be sold again.
      await expect(
        reachPayment(ctx, [
          { productId: train.id, lineConfig: { from: "dijon", to: "paris" } },
        ]),
      ).rejects.toThrow(/no room/);
    });

    it("settles a mixed cart as one order: two legs, a good and a court", async ({
      expect,
    }) => {
      const ctx = await setup(backend);
      const train = await aTrain(ctx);
      const court = `court-${randomUUID()}`;
      const padel = await ctx.catalog.create({
        kind: "test-court",
        slug: `padel-${randomUUID()}`,
        name: "Padel, 90 minutes",
        price: 3000,
        published: true,
        config: { courts: [court] },
      });
      const guide = await ctx.catalog.create({
        slug: `guide-${randomUUID()}`,
        name: "Guide de Paris",
        price: 1500,
        published: true,
        config: { trackStock: true },
      });
      await ctx.stock.recordIntake(guide.id, 3);

      const { orderId, handoff } = await reachPayment(ctx, [
        { productId: guide.id },
        {
          productId: padel.id,
          lineConfig: {
            resourceIds: [court],
            startsAt: at("18:00"),
            endsAt: at("19:30"),
          },
        },
        { productId: train.id, lineConfig: { from: "lyon", to: "paris" } },
      ]);
      await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

      const order = await ctx.orders.getById(orderId);
      expect(order.status).toBe("paid");
      expect(order.total).toBe(1500 + 3000 + 4900);
      expect(await ctx.orders.itemsOf(orderId)).toHaveLength(3);
      expect(
        (await ctx.resources.claimsOf(orderId)).map((it) => it.status),
      ).toEqual(["consumed", "consumed", "consumed"]);
      expect(await ctx.stock.onHand(guide.id)).toBe(2);
    });
  });

  describe.each(["postgres", "sqlite", "d1"] as const)("on %s", (backend) => {
    it("keeps no leg when the other one is gone", async ({ expect }) => {
      const ctx = await setup(backend);
      const train = await aTrain(ctx);
      await reachPayment(ctx, [
        { productId: train.id, lineConfig: { from: "dijon", to: "paris" } },
      ]);

      await expect(
        reachPayment(ctx, [
          { productId: train.id, lineConfig: { from: "lyon", to: "paris" } },
        ]),
      ).rejects.toThrow(/no room/);

      // Lyon to Dijon was never taken for good: it is still for sale.
      const { orderId } = await reachPayment(ctx, [
        { productId: train.id, lineConfig: { from: "lyon", to: "dijon" } },
      ]);
      expect(await liveClaims(ctx, orderId)).toHaveLength(1);
    });

    /*
     * Racers for one seat: two travellers from Lyon to Paris and one from
     * Dijon. On D1 the Dijon racer can land between a Lyon order's two
     * claims, and that order must then keep neither. On Postgres every lock
     * an order needs is taken before its first claim, so the racers queue;
     * SQLite serialises the orders' transactions. Whichever, no leg is sold
     * twice, and no order keeps half a journey.
     */
    it("never leaves an order with half its journey under a racer", async ({
      expect,
    }) => {
      const ctx = await setup(backend);

      for (let round = 0; round < 5; round++) {
        const train = await aTrain(ctx);
        const { first, second } = legsOf(train);
        const journeys = [
          { from: "lyon", to: "paris", legs: 2 },
          { from: "lyon", to: "paris", legs: 2 },
          { from: "dijon", to: "paris", legs: 1 },
        ];

        const orders = await Promise.all(
          journeys.map((journey) =>
            ctx.orders
              .create({
                lines: [
                  {
                    productId: train.id,
                    quantity: 1,
                    lineConfig: { from: journey.from, to: journey.to },
                  },
                ],
              })
              .then(
                (order) => order.id,
                () => undefined,
              ),
          ),
        );

        const kept: number[] = [];
        for (const [index, orderId] of orders.entries()) {
          const claims = orderId ? await liveClaims(ctx, orderId) : [];
          // All of the journey or none of it.
          expect([0, journeys[index]!.legs]).toContain(claims.length);
          kept.push(claims.length);
        }

        // Somebody travels, and the second leg is sold once at most.
        expect(kept.some((it) => it > 0)).toBe(true);
        for (const leg of [first, second]) {
          const occupied = await ctx.resources.occupancy(leg, {
            startsAt: at("00:00"),
            endsAt: at("23:59"),
          });
          expect(occupied.length).toBeLessThanOrEqual(1);
        }
        // The two Lyon travellers never both win.
        expect(kept.slice(0, 2).filter((it) => it === 2)).toHaveLength(
          kept[2] === 1 ? 0 : 1,
        );
      }
    });
  });
});
