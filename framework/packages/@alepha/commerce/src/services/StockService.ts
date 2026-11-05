import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, type Page, type SQL, sql } from "alepha/orm";

import {
  type StockMovementEntity,
  stockMovements,
} from "../entities/stockMovements.ts";
import {
  type StockReservationEntity,
  stockReservations,
} from "../entities/stockReservations.ts";
import { InsufficientStockError } from "../errors/CommerceError.ts";
import { ClaimLock, type ClaimLockKey } from "./ClaimLock.ts";

/**
 * What the ledger says about one product or variant.
 */
export interface StockFigure {
  onHand: number;
  reserved: number;
  available: number;
}

/**
 * The figures of a page of products, read at once.
 */
export interface StockFigures {
  /**
   * Without a variant, the product's total. Zero for what the ledger does not
   * know.
   */
  of(productId: string, variantId?: string): StockFigure;
}

/**
 * Stock, as an append-only ledger plus a set of temporary holds.
 *
 * Three numbers, and confusing them is how shops oversell:
 *
 * - {@link onHand} - what is physically there: the sum of movements.
 * - {@link reserved} - what is spoken for: live, unexpired holds.
 * - {@link available} - what may still be sold: on-hand minus reserved. **This
 *   is the one a storefront shows and the one {@link reserve} checks.**
 *
 * Each takes an optional variant. Without one it sums everything under the
 * product, which is the product's own figure when it has no variants and the
 * total across them when it has.
 *
 * Ported from a downstream app's `StockService`, which learned the hard way
 * that a counter column oversells: two concurrent sales read the same
 * snapshot, both see enough, both write.
 *
 * ### One of two inventory shapes
 *
 * This is **fungible stock**: a quantity on a product, where any unit will do.
 * Three tennis balls, a t-shirt in size M. When what is sold is a particular
 * thing for a particular time (court 3 on Saturday from 18:00, seat 12A on the
 * Lyon leg, room 204 on the night of the 4th) a count cannot express it: use
 * `ResourceService`, which holds claims on a named resource over an
 * interval, through the same claim lock and the same hold lifecycle.
 *
 * ### How the same race is closed here
 *
 * Checking before writing cannot close it on its own: on Postgres at READ
 * COMMITTED two transactions read the same sum before either commits, and
 * there is no counter row to lock - on-hand is a SUM over an append-only
 * ledger.
 *
 * So every claim ({@link reserve}, {@link recordSale}) goes through
 * {@link claim}, which lets one claim per product decide at a time. How
 * depends on the database:
 *
 * - **Postgres** takes a transaction-scoped advisory lock on the product, then
 *   checks and writes. The lock is released at COMMIT, so the next claim's
 *   check sees this one's row, including when the claim runs inside a caller's
 *   transaction, the way `OrderService.create` runs it.
 * - **SQLite, D1 and PGlite** have a single writer and no such lock (D1 and
 *   PGlite have no interactive transaction to hold one in). There the claim is
 *   written first and checked second: every racer reads the claims back in the
 *   order they were written and keeps its own only if it fits.
 *
 * Postgres used to take the second path too, and oversold under load. It read
 * the claims back ordered by `(createdAt, id)`, and `createdAt` is `now()`:
 * the moment the inserting transaction STARTED, not the moment its row became
 * visible. A racer stamped later could read the claims back before an earlier
 * one had committed, count too little and keep its own, and the earlier one
 * kept its own too. No key assigned before COMMIT can agree with visibility,
 * which is why Postgres locks instead of ordering.
 */
export class StockService {
  /**
   * How long a hold survives without a settled payment.
   */
  public static readonly RESERVATION_TTL_MINUTES = 30;

  /**
   * First key of the per-product advisory lock on Postgres; the second is the
   * product id. Its own key space, so no other advisory lock in the database
   * can collide with a product's.
   */
  public static readonly LOCK_NAMESPACE = "alepha:commerce:stock";

  /**
   * The lock a claim takes: on the variant when there is one, so two sizes of
   * one shirt do not contend, on the product otherwise. A product sold by
   * variant is never claimed at product level: the cart refuses such a line.
   */
  public static lockKey(productId: string, variantId?: string): ClaimLockKey {
    return {
      namespace: StockService.LOCK_NAMESPACE,
      key: variantId ?? productId,
    };
  }

  protected readonly log = $logger();
  protected readonly lock = $inject(ClaimLock);
  protected readonly movements = $repository(stockMovements);
  protected readonly reservations = $repository(stockReservations);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Mark expired holds as released, and report how many.
   *
   * A plain method, not a `$job`: scheduling it would make this package depend
   * on `alepha/api/jobs`, and a point-of-sale - which has no payment window and
   * so no holds - would carry the job system for nothing. The scheduler lives in
   * `@alepha/commerce/checkout`, which already has jobs via the payments module.
   *
   * Nothing depends on this running promptly: {@link reserved} already excludes
   * expired holds, so a late sweep delays tidying, it never oversells.
   */
  public async releaseExpiredReservations(): Promise<number> {
    const now = this.dateTime.nowISOString();
    const released = await this.reservations.updateMany(
      { status: { eq: "held" }, expiresAt: { lt: now } },
      { status: "released" },
    );

    if (released.length > 0) {
      this.log.info(`Released ${released.length} expired stock reservation(s)`);
    }
    return released.length;
  }

  // -------------------------------------------------------------------------
  // Reading

  /**
   * What is physically in stock: the sum of the movement ledger.
   *
   * Call inside the transaction that is about to write a movement - a value read
   * outside it is stale by the time it is acted on.
   */
  public async onHand(productId: string, variantId?: string): Promise<number> {
    const [row] = await this.movements.aggregate({
      select: { delta: { sum: true } },
      where: {
        productId: { eq: productId },
        ...(variantId ? { variantId: { eq: variantId } } : {}),
      },
    });
    return Number(row?.delta.sum ?? 0);
  }

  /**
   * What live holds have spoken for. Expired holds are excluded here, not just
   * by the sweep, so a late sweep can never cause an oversell.
   */
  public async reserved(
    productId: string,
    variantId?: string,
  ): Promise<number> {
    const [row] = await this.reservations.aggregate({
      select: { quantity: { sum: true } },
      where: {
        productId: { eq: productId },
        ...(variantId ? { variantId: { eq: variantId } } : {}),
        status: { eq: "held" },
        expiresAt: { gte: this.dateTime.nowISOString() },
      },
    });
    return Number(row?.quantity.sum ?? 0);
  }

  /**
   * What may still be sold. This is what a storefront should display.
   */
  public async available(
    productId: string,
    variantId?: string,
  ): Promise<number> {
    const [onHand, reserved] = await Promise.all([
      this.onHand(productId, variantId),
      this.reserved(productId, variantId),
    ]);
    return onHand - reserved;
  }

  /**
   * The figures of many products in two queries, whatever their number: one
   * sum per product and variant over the ledger, one over the live holds.
   *
   * What a list reads. {@link available} per row was two scans per product on
   * the busiest page of a shop.
   */
  public async figuresFor(productIds: string[]): Promise<StockFigures> {
    const totals = new Map<string, { onHand: number; reserved: number }>();
    const add = (
      key: string,
      field: "onHand" | "reserved",
      value: number,
    ): void => {
      const entry = totals.get(key) ?? { onHand: 0, reserved: 0 };
      entry[field] += value;
      totals.set(key, entry);
    };
    const keyOf = (productId: string, variantId?: string | null) =>
      `${productId}:${variantId ?? ""}`;

    if (productIds.length > 0) {
      const movements = await this.movements.aggregate({
        select: {
          productId: true,
          variantId: true,
          delta: { sum: true },
        },
        where: { productId: { inArray: productIds } },
        groupBy: ["productId", "variantId"],
      });
      for (const row of movements) {
        const value = Number(row.delta.sum ?? 0);
        add(keyOf(row.productId), "onHand", value);
        if (row.variantId) {
          add(keyOf(row.productId, row.variantId), "onHand", value);
        }
      }

      const holds = await this.reservations.aggregate({
        select: {
          productId: true,
          variantId: true,
          quantity: { sum: true },
        },
        where: {
          productId: { inArray: productIds },
          status: { eq: "held" },
          expiresAt: { gte: this.dateTime.nowISOString() },
        },
        groupBy: ["productId", "variantId"],
      });
      for (const row of holds) {
        const value = Number(row.quantity.sum ?? 0);
        add(keyOf(row.productId), "reserved", value);
        if (row.variantId) {
          add(keyOf(row.productId, row.variantId), "reserved", value);
        }
      }
    }

    return {
      of: (productId, variantId) => {
        const { onHand, reserved } = totals.get(
          keyOf(productId, variantId),
        ) ?? { onHand: 0, reserved: 0 };
        return { onHand, reserved, available: onHand - reserved };
      },
    };
  }

  /**
   * The ids of the products with something to sell, as a subquery: on-hand
   * above live holds, summed by the database. What a catalogue filter puts in
   * its `where`, since availability cannot be a column.
   */
  public availableProducts(): SQL {
    const movements = this.movements.table;
    const holds = this.reservations.table;
    const now = this.dateTime.nowISOString();
    return sql`(SELECT ${movements.productId} FROM ${movements}
      GROUP BY ${movements.productId}
      HAVING SUM(${movements.delta}) > COALESCE((
        SELECT SUM(${holds.quantity}) FROM ${holds}
        WHERE ${holds.productId} = ${movements.productId}
          AND ${holds.status} = 'held'
          AND ${holds.expiresAt} >= ${now}
      ), 0))`;
  }

  // -------------------------------------------------------------------------
  // Holds

  /**
   * Take a hold for an order, refusing to exceed what is available.
   *
   * @throws InsufficientStockError
   */
  public async reserve(
    productId: string,
    quantity: number,
    options: { orderId: string; ttlMinutes?: number; variantId?: string },
  ): Promise<StockReservationEntity> {
    const { variantId } = options;
    return this.claim(productId, variantId, async (locked) => {
      // Under the lock this check is the decision. Without it, it only
      // rejects the obviously impossible before anything is written: two
      // racers can both pass it, and the replay below decides.
      const available = await this.available(productId, variantId);
      if (available < quantity) {
        throw new InsufficientStockError({
          productId,
          requested: quantity,
          onHand: available,
        });
      }

      const ttl = options.ttlMinutes ?? StockService.RESERVATION_TTL_MINUTES;
      const hold = await this.reservations.create({
        productId,
        variantId,
        quantity,
        orderId: options.orderId,
        status: "held",
        expiresAt: new Date(
          this.dateTime.nowMillis() + ttl * 60_000,
        ).toISOString(),
      });

      if (!locked && !(await this.holdFits(productId, variantId, hold.id))) {
        await this.reservations.updateById(hold.id, { status: "released" });
        throw new InsufficientStockError({
          productId,
          requested: quantity,
          onHand: Math.max(0, await this.available(productId, variantId)),
        });
      }

      return hold;
    });
  }

  /**
   * Run one claim on a product's stock so that no other claim on the same
   * product, or variant, decides at the same time, and tell it whether its own
   * check is
   * the decision. See {@link ClaimLock} for how, on each database.
   *
   * Where `locked` is false the claim must replay: see {@link holdFits} and
   * {@link movementFits}.
   */
  protected async claim<R>(
    productId: string,
    variantId: string | undefined,
    decide: (locked: boolean) => Promise<R>,
  ): Promise<R> {
    return this.lock.run(StockService.lockKey(productId, variantId), decide);
  }

  /**
   * Whether a hold just written is one the stock can actually back, on a
   * database where {@link claim} holds no lock.
   *
   * Every live hold is read back in the order it was written, and the
   * quantities are summed up to and including this one. The hold survives if
   * that running total still fits within on-hand - so N racers for M units
   * leave exactly as many holds standing as M allows, and the ones that lose
   * are the ones that arrived last.
   *
   * `(createdAt, id)` is the order of writing only because these databases
   * have one writer: `createdAt` is stamped by the database as it inserts, one
   * row after another, and a tie falls back to the UUIDv7 id, which increases
   * in the order this process generated it. On Postgres neither holds, which
   * is why {@link claim} locks there instead.
   *
   * A hold that is no longer in the list at all (expired or released between
   * the write and this read) loses too: it is no longer holding anything.
   */
  protected async holdFits(
    productId: string,
    variantId: string | undefined,
    holdId: string,
  ): Promise<boolean> {
    const now = this.dateTime.nowISOString();
    const [onHand, holds] = await Promise.all([
      this.onHand(productId, variantId),
      this.reservations.findMany({
        where: {
          productId: { eq: productId },
          ...(variantId ? { variantId: { eq: variantId } } : {}),
          status: { eq: "held" },
          expiresAt: { gte: now },
        },
        orderBy: [
          { column: "createdAt", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        columns: ["id", "quantity"],
      }),
    ]);

    let running = 0;
    for (const hold of holds) {
      running += hold.quantity;
      if (hold.id === holdId) {
        return running <= onHand;
      }
    }

    return false;
  }

  /**
   * Give up an order's holds - the payment failed, or the buyer walked away.
   * Idempotent: a hold already consumed or released is left alone.
   */
  public async releaseFor(orderId: string): Promise<void> {
    await this.reservations.updateMany(
      { orderId: { eq: orderId }, status: { eq: "held" } },
      { status: "released" },
    );
  }

  /**
   * @public A read for applications and for tests - nothing in this package
   * needs it, because the services that create holds already hold the rows.
   * Covered by `stockReservation.spec.ts`.
   */
  public async reservationsOf(
    orderId: string,
  ): Promise<StockReservationEntity[]> {
    return this.reservations.findMany({ where: { orderId: { eq: orderId } } });
  }

  // -------------------------------------------------------------------------
  // Movements

  /**
   * Record a sale, and consume the order's hold if it had one.
   *
   * The check is on-hand minus what OTHER orders hold, not `available`: the
   * order being settled is precisely the one whose hold made those units
   * unavailable to others, so counting its own hold against it would refuse
   * every reserved sale. Counting nothing but on-hand was the opposite
   * mistake: a capture landing after its own hold expired took units still
   * held by another buyer's live checkout, and THEIR settlement then failed
   * with their money taken.
   *
   * Idempotent on the order line: `ProductKindHandler.fulfil` is re-delivered,
   * and a line the ledger already counts as sold is not sold twice. By the
   * order's line and not the order, because one order can carry a product on
   * two lines. Without an `orderItemId` it is one sale per order and product;
   * without an `orderId`, a counter sale nothing can redeliver.
   *
   * @throws InsufficientStockError when the units are not physically there.
   */
  public async recordSale(
    productId: string,
    quantity: number,
    context: {
      orderId?: string;
      orderItemId?: string;
      variantId?: string;
    } = {},
  ): Promise<void> {
    const { variantId } = context;
    await this.claim(productId, variantId, async (locked) => {
      if (await this.alreadySold(productId, context)) {
        return;
      }

      // The decision under the lock, a fast pre-check without it: same as
      // `reserve`.
      const sellable =
        (await this.onHand(productId, variantId)) -
        (await this.heldByOthers(productId, variantId, context.orderId));
      if (sellable < quantity) {
        throw new InsufficientStockError({
          productId,
          requested: quantity,
          onHand: sellable,
        });
      }

      const movement = await this.movements.create({
        productId,
        variantId,
        delta: -quantity,
        reason: "sale",
        orderId: context.orderId,
        orderItemId: context.orderItemId,
      });

      if (
        !locked &&
        !(await this.movementFits(productId, variantId, movement.id))
      ) {
        await this.movements.deleteById(movement.id);
        throw new InsufficientStockError({
          productId,
          requested: quantity,
          onHand: Math.max(0, await this.onHand(productId, variantId)),
        });
      }

      // Inside the claim, so on Postgres the sale and the hold it uses up
      // commit together: no reader sees the units both sold and still held.
      if (context.orderId) {
        await this.consumeHold(context.orderId, productId, quantity, variantId);
      }
    });
  }

  /**
   * What live holds of other orders speak for: all of them, for a sale with
   * no order.
   */
  protected async heldByOthers(
    productId: string,
    variantId: string | undefined,
    orderId?: string,
  ): Promise<number> {
    const [row] = await this.reservations.aggregate({
      select: { quantity: { sum: true } },
      where: {
        productId: { eq: productId },
        ...(variantId ? { variantId: { eq: variantId } } : {}),
        status: { eq: "held" },
        expiresAt: { gte: this.dateTime.nowISOString() },
        ...(orderId ? { orderId: { ne: orderId } } : {}),
      },
    });
    return Number(row?.quantity.sum ?? 0);
  }

  /**
   * Whether the ledger counts this line as sold: its sales and the returns
   * against them leave units out, so a line whose sale was given back sells
   * again.
   */
  protected async alreadySold(
    productId: string,
    context: { orderId?: string; orderItemId?: string },
  ): Promise<boolean> {
    if (!context.orderId) {
      return false;
    }
    const [row] = await this.movements.aggregate({
      select: { delta: { sum: true } },
      where: {
        orderId: { eq: context.orderId },
        productId: { eq: productId },
        reason: { inArray: ["sale", "return"] },
        orderItemId: context.orderItemId
          ? { eq: context.orderItemId }
          : { isNull: true },
      },
    });
    return Number(row?.delta.sum ?? 0) < 0;
  }

  /**
   * Whether a sale just written is one the ledger can actually back, on a
   * database where {@link claim} holds no lock.
   *
   * The ledger is summed in the order it was written - see {@link holdFits}
   * for why `(createdAt, id)` is that order there and not on Postgres - up to
   * and including this movement.
   * The sale survives if the running balance never went negative at its own
   * row.
   *
   * A PREFIX, not a snapshot, and that distinction is the whole correctness
   * argument: rows written after this one cannot change the sum before it, and
   * rows written before it are already committed. So the answer does not
   * depend on how many racers happen to have landed by the time this runs -
   * an earlier version compared against a live `onHand` and let a racer that
   * checked early survive a deficit that later racers then had to absorb,
   * which oversold under load.
   *
   * Rolling back a loser only lifts the balance for rows after it, so it can
   * never turn a survivor into a loser; and a winner never re-checks. The
   * count that survives is therefore exact, not merely safe.
   */
  protected async movementFits(
    productId: string,
    variantId: string | undefined,
    movementId: string,
  ): Promise<boolean> {
    const movement = await this.movements.findById(movementId);
    if (!movement) {
      return false;
    }

    const [row] = await this.movements.aggregate({
      select: { delta: { sum: true } },
      where: {
        productId: { eq: productId },
        ...(variantId ? { variantId: { eq: variantId } } : {}),
        or: [
          { createdAt: { lt: movement.createdAt } },
          { createdAt: { eq: movement.createdAt }, id: { lte: movementId } },
        ],
      },
    });
    return Number(row?.delta.sum ?? 0) >= 0;
  }

  /**
   * Add stock. `reason` distinguishes a delivery from a customer return, which
   * the two consumers of this ledger (margin reporting, returns) need apart.
   */
  public async recordIntake(
    productId: string,
    quantity: number,
    options: {
      reason?: "intake" | "return";
      note?: string;
      variantId?: string;
    } = {},
  ): Promise<void> {
    await this.movements.create({
      productId,
      variantId: options.variantId,
      delta: quantity,
      reason: options.reason ?? "intake",
      note: options.note,
    });
  }

  /**
   * Correct the count, in either direction.
   *
   * Distinct from {@link recordIntake} because the reason is different and the
   * ledger is read by reason: an intake is stock arriving, an adjustment is the
   * book being wrong - breakage, a miscount, a unit written off. Rolling them
   * together would make "how much did we take in this quarter" unanswerable.
   *
   * `delta` is signed and must not be zero; a zero movement is a row that says
   * nothing and still shows up in the ledger an operator reads.
   */
  public async recordAdjustment(
    productId: string,
    delta: number,
    options: { note?: string; variantId?: string } = {},
  ): Promise<void> {
    if (delta === 0) {
      throw new AlephaError("A stock adjustment cannot be zero.");
    }
    await this.movements.create({
      productId,
      variantId: options.variantId,
      delta,
      reason: "adjustment",
      note: options.note,
    });
  }

  /**
   * The product's ledger, newest first - every movement and why it happened.
   *
   * Paginated rather than returned whole: this table only grows, and a product
   * that has sold for a year has a ledger no screen wants in one response.
   */
  public async movementsOf(
    productId: string,
    query: { size?: number; page?: number; sort?: string } = {},
  ): Promise<Page<StockMovementEntity>> {
    return this.movements.paginate(
      { sort: "-createdAt", ...query },
      { where: { productId: { eq: productId } } },
      { count: true },
    );
  }

  /**
   * Give back units of one order line: a return that came back, a line
   * cancelled before shipping.
   *
   * Up to what the ledger still counts as out for that line, so it cannot
   * restock what a full refund already gave back, and it runs under the lock
   * for the reason {@link releaseOrder} does.
   */
  public async releaseLine(
    line: {
      orderId: string;
      orderItemId: string;
      productId: string;
      variantId?: string;
    },
    quantity: number,
  ): Promise<void> {
    await this.claim(line.productId, line.variantId, async () => {
      const rows = await this.movementsOfOrder(line.orderId);
      const out = -rows
        .filter((row) => row.orderItemId === line.orderItemId)
        .reduce((sum, row) => sum + row.delta, 0);

      const back = Math.min(quantity, out);
      if (back > 0) {
        await this.movements.create({
          productId: line.productId,
          variantId: line.variantId,
          delta: back,
          reason: "return",
          orderId: line.orderId,
          orderItemId: line.orderItemId,
        });
      }
    });
  }

  /**
   * Put back what a cancelled or refunded order had taken, and drop any hold it
   * still carried.
   *
   * Idempotent: it gives back what the ledger still counts as out for the
   * order, line by line, so a second run finds nothing left. Under the locks
   * of the products involved, so two runs that overlap cannot both read the
   * same remainder.
   */
  public async releaseOrder(orderId: string): Promise<void> {
    const sold = await this.movementsOfOrder(orderId);
    const keys = sold.map((it) =>
      StockService.lockKey(it.productId, it.variantId),
    );

    await this.lock.run(keys, async () => {
      const out = new Map<
        string,
        Omit<StockMovementEntity, "id" | "createdAt">
      >();
      for (const row of await this.movementsOfOrder(orderId)) {
        const key = `${row.productId}:${row.orderItemId ?? ""}`;
        const line = out.get(key) ?? { ...row, delta: 0 };
        out.set(key, { ...line, delta: line.delta + row.delta });
      }

      for (const line of out.values()) {
        if (line.delta < 0) {
          await this.movements.create({
            productId: line.productId,
            variantId: line.variantId,
            delta: -line.delta,
            reason: "return",
            orderId,
            orderItemId: line.orderItemId,
            note: `Release of order ${orderId}`,
          });
        }
      }
    });

    await this.releaseFor(orderId);
  }

  protected async movementsOfOrder(
    orderId: string,
  ): Promise<StockMovementEntity[]> {
    return this.movements.findMany({
      where: {
        orderId: { eq: orderId },
        reason: { inArray: ["sale", "return"] },
      },
    });
  }

  /**
   * Mark an order's hold on a product as used up.
   *
   * Only holds still `held` are touched; a redelivered webhook that re-runs
   * fulfilment finds nothing to consume, which is what makes settlement
   * idempotent at this level too.
   */
  protected async consumeHold(
    orderId: string,
    productId: string,
    quantity: number,
    variantId?: string,
  ): Promise<void> {
    const holds = await this.reservations.findMany({
      where: {
        orderId: { eq: orderId },
        productId: { eq: productId },
        ...(variantId ? { variantId: { eq: variantId } } : {}),
        status: { eq: "held" },
      },
    });

    let remaining = quantity;
    for (const hold of holds) {
      if (remaining <= 0) break;
      await this.reservations.updateById(hold.id, { status: "consumed" });
      remaining -= hold.quantity;
    }
  }
}
