import { randomUUID } from "node:crypto";

import { Alepha, z } from "alepha";
import { DatabaseProvider, sql } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import type { OrderItemEntity } from "../entities/orderItems.ts";
import { AlephaCommerce } from "../index.ts";
import { ResourceKindHandler } from "../kinds/ResourceKindHandler.ts";
import { ProductKindRegistry } from "../providers/ProductKindRegistry.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { ResourceService } from "../services/ResourceService.ts";
import { StockService } from "../services/StockService.ts";

interface Leg {
  resourceId: string;
  startsAt: string;
  endsAt: string;
}

/**
 * A line claiming its legs in exactly the order it lists them, at the
 * product's capacity: what lets a spec hand an order its locks backwards.
 */
class TestLegsKind extends ResourceKindHandler {
  public readonly kind = "test-legs";
  public readonly configSchema = z.object({ capacity: z.integer() });
  public readonly lineSchema = z.object({
    legs: z.array(
      z.object({ resourceId: z.text(), startsAt: z.text(), endsAt: z.text() }),
    ),
  });

  public async validateLine(): Promise<void> {}

  public resolve(item: OrderItemEntity) {
    const capacity = (item.config as { capacity: number }).capacity;
    return (item.lineConfig as { legs: Leg[] }).legs.map((leg) => ({
      ...leg,
      capacity,
    }));
  }
}

/**
 * Postgres only: it is the one database that holds claim locks, and the one
 * where taking them in two orders deadlocks.
 */
const setup = async () => {
  const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaCommerce);
  alepha.inject(ProductKindRegistry).add(alepha.inject(TestLegsKind));
  const ctx = {
    alepha,
    catalog: alepha.inject(CatalogService),
    orders: alepha.inject(OrderService),
    resources: alepha.inject(ResourceService),
    stock: alepha.inject(StockService),
    db: alepha.inject(DatabaseProvider),
  };
  await alepha.start();
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const at = (hhmm: string) => `2030-01-05T${hhmm}:00.000Z`;

const leg = (resourceId: string, from: string, to: string): Leg => ({
  resourceId,
  startsAt: at(from),
  endsAt: at(to),
});

const legs = (ctx: Ctx, capacity = 1) =>
  ctx.catalog.create({
    kind: "test-legs",
    slug: `legs-${randomUUID()}`,
    name: "Padel, 60 minutes",
    price: 2000,
    published: true,
    config: { capacity },
  });

/**
 * Two resource ids in the order the sorted lock pass takes them.
 */
const twoCourts = () =>
  [`court-${randomUUID()}`, `court-${randomUUID()}`].sort() as [string, string];

/**
 * How many sessions are queued on one claim lock right now.
 */
const waitingOn = async (ctx: Ctx, namespace: string, key: string) => {
  const [row] = await ctx.db.execute(sql`
    SELECT count(*)::int AS waiting FROM pg_locks
    WHERE locktype = 'advisory' AND NOT granted AND objsubid = 2
      AND classid = hashtext(${namespace})::oid
      AND objid = hashtext(${key})::oid`);
  return Number(row?.waiting ?? 0);
};

/**
 * A transaction that takes one claim, pauses until told to go on, then takes
 * another: an order caught between its two locks, in the global order.
 */
const pausedBetween = (
  ctx: Ctx,
  first: () => Promise<unknown>,
  second: () => Promise<unknown>,
) => {
  let resume!: () => void;
  let tookFirst!: () => void;
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const holding = new Promise<void>((resolve) => {
    tookFirst = resolve;
  });
  const outcome = ctx.db
    .transactional(async () => {
      try {
        await first();
      } finally {
        tookFirst();
      }
      await paused;
      await second();
    })
    .then(() => "won", reason);
  return { holding, resume, outcome };
};

/**
 * A failure reads as the driver's own message ("deadlock detected"), not
 * drizzle's "Failed query" wrapper around it.
 */
const reason = (error: Error) =>
  (error.cause as Error | undefined)?.message ?? error.message;

describe("lock order", () => {
  it("settles two orders that list the same two courts the other way round", async ({
    expect,
  }) => {
    const ctx = await setup();
    const product = await legs(ctx);
    const [low, high] = twoCourts();

    const first = pausedBetween(
      ctx,
      () =>
        ctx.resources.reserve(low, {
          ...leg(low, "10:00", "11:00"),
          capacity: 1,
          orderId: randomUUID(),
        }),
      () =>
        ctx.resources.reserve(high, {
          ...leg(high, "10:00", "11:00"),
          capacity: 1,
          orderId: randomUUID(),
        }),
    );
    await first.holding;

    // Same product on both lines, courts listed high then low: walking the
    // lines by product id could not tell them apart.
    const second = ctx.orders
      .create({
        lines: [
          {
            productId: product.id,
            quantity: 1,
            lineConfig: { legs: [leg(high, "12:00", "13:00")] },
          },
          {
            productId: product.id,
            quantity: 1,
            lineConfig: { legs: [leg(low, "12:00", "13:00")] },
          },
        ],
      })
      .then(() => "won", reason);

    // It queues on the lower court, holding nothing the first one needs.
    await expect
      .poll(() => waitingOn(ctx, ResourceService.LOCK_NAMESPACE, low))
      .toBe(1);
    first.resume();

    expect([await first.outcome, await second]).toEqual(["won", "won"]);
  });

  it("settles a stock line and a resource line taken in opposite orders", async ({
    expect,
  }) => {
    const ctx = await setup();
    const product = await legs(ctx);
    const [court] = twoCourts();
    const ring = await ctx.catalog.create({
      slug: `ring-${randomUUID()}`,
      name: "Bague Aurore",
      price: 8900,
      published: true,
      config: { trackStock: true },
    });
    await ctx.stock.recordIntake(ring.id, 2);

    // `alepha:commerce:resource` sorts before `alepha:commerce:stock`.
    const first = pausedBetween(
      ctx,
      () =>
        ctx.resources.reserve(court, {
          ...leg(court, "10:00", "11:00"),
          capacity: 1,
          orderId: randomUUID(),
        }),
      () => ctx.stock.reserve(ring.id, 1, { orderId: randomUUID() }),
    );
    await first.holding;

    // The ring first in the cart: taken first, it would be held while the
    // court is waited on, and the first order could never get it.
    const second = ctx.orders
      .create({
        lines: [
          { productId: ring.id, quantity: 1 },
          {
            productId: product.id,
            quantity: 1,
            lineConfig: { legs: [leg(court, "12:00", "13:00")] },
          },
        ],
      })
      .then(() => "won", reason);

    await expect
      .poll(() => waitingOn(ctx, ResourceService.LOCK_NAMESPACE, court))
      .toBe(1);
    first.resume();

    expect([await first.outcome, await second]).toEqual(["won", "won"]);
    expect(await ctx.stock.reserved(ring.id)).toBe(2);
  });

  it("takes a two-leg line's locks in key order, whatever order resolve() returns", async ({
    expect,
  }) => {
    const ctx = await setup();
    // Room for both travellers: the legs are shared, the locks contended.
    const product = await legs(ctx, 2);
    const [lyon, paris] = twoCourts();

    const first = pausedBetween(
      ctx,
      () =>
        ctx.resources.reserve(lyon, {
          ...leg(lyon, "08:00", "10:00"),
          capacity: 2,
          orderId: randomUUID(),
        }),
      () =>
        ctx.resources.reserve(paris, {
          ...leg(paris, "10:00", "12:00"),
          capacity: 2,
          orderId: randomUUID(),
        }),
    );
    await first.holding;

    // One line, its legs listed backwards.
    const second = ctx.orders
      .create({
        lines: [
          {
            productId: product.id,
            quantity: 1,
            lineConfig: {
              legs: [leg(paris, "10:00", "12:00"), leg(lyon, "08:00", "10:00")],
            },
          },
        ],
      })
      .then(() => "won", reason);

    await expect
      .poll(() => waitingOn(ctx, ResourceService.LOCK_NAMESPACE, lyon))
      .toBe(1);
    first.resume();

    expect([await first.outcome, await second]).toEqual(["won", "won"]);
  });
});
