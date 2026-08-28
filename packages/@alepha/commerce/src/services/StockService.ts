import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, type Page } from "alepha/orm";

import {
  type StockMovementEntity,
  stockMovements,
} from "../entities/stockMovements.ts";
import {
  type StockReservationEntity,
  stockReservations,
} from "../entities/stockReservations.ts";
import { InsufficientStockError } from "../errors/CommerceError.ts";

/**
 * Stock, as an append-only ledger plus a set of temporary holds.
 *
 * Three numbers, and confusing them is how shops oversell:
 *
 * - {@link onHand} — what is physically there: the sum of movements.
 * - {@link reserved} — what is spoken for: live, unexpired holds.
 * - {@link available} — what may still be sold: on-hand minus reserved. **This
 *   is the one a storefront shows and the one {@link reserve} checks.**
 *
 * Ported from Club's `StockService`, which learned the hard way that a counter
 * column oversells: two concurrent sales read the same snapshot, both see
 * enough, both write.
 *
 * ### How the same race is closed here
 *
 * Checking before writing cannot close it: on Postgres at READ COMMITTED two
 * transactions read the same sum before either commits, and there is no
 * counter row to lock - on-hand is a SUM over an append-only ledger.
 *
 * So the write comes first and the check second. Every racer inserts its claim,
 * then reads the claims back in one deterministic order - `(createdAt, id)`,
 * which every racer computes identically - and keeps its own only if it fits.
 * Exactly as many claims survive as there is stock for, whoever ran first, and
 * it needs no row lock, so it behaves the same on SQLite and D1.
 */
export class StockService {
  /**
   * How long a hold survives without a settled payment.
   */
  public static readonly RESERVATION_TTL_MINUTES = 30;

  protected readonly log = $logger();
  protected readonly movements = $repository(stockMovements);
  protected readonly reservations = $repository(stockReservations);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Mark expired holds as released, and report how many.
   *
   * A plain method, not a `$job`: scheduling it would make this package depend
   * on `alepha/api/jobs`, and a point-of-sale — which has no payment window and
   * so no holds — would carry the job system for nothing. The scheduler lives in
   * `@alepha/commerce/checkout`, which already has jobs via the payments module.
   *
   * Nothing depends on this running promptly: {@link reserved} already excludes
   * expired holds, so a late sweep delays tidying, it never oversells.
   */
  public async releaseExpiredReservations(): Promise<number> {
    const now = this.dateTime.nowISOString();
    const stale = await this.reservations.findMany({
      where: { status: { eq: "held" }, expiresAt: { lt: now } },
    });

    for (const hold of stale) {
      await this.reservations.updateById(hold.id, { status: "released" });
    }

    if (stale.length > 0) {
      this.log.info(`Released ${stale.length} expired stock reservation(s)`);
    }
    return stale.length;
  }

  // -------------------------------------------------------------------------
  // Reading

  /**
   * What is physically in stock: the sum of the movement ledger.
   *
   * Call inside the transaction that is about to write a movement — a value read
   * outside it is stale by the time it is acted on.
   */
  public async onHand(productId: string): Promise<number> {
    const rows = await this.movements.findMany({
      where: { productId: { eq: productId } },
      columns: ["delta"],
    });
    return rows.reduce((sum, row) => sum + row.delta, 0);
  }

  /**
   * What live holds have spoken for. Expired holds are excluded here, not just
   * by the sweep, so a late sweep can never cause an oversell.
   */
  public async reserved(productId: string): Promise<number> {
    const now = this.dateTime.nowISOString();
    const holds = await this.reservations.findMany({
      where: {
        productId: { eq: productId },
        status: { eq: "held" },
        expiresAt: { gte: now },
      },
      columns: ["quantity"],
    });
    return holds.reduce((sum, hold) => sum + hold.quantity, 0);
  }

  /**
   * What may still be sold. This is what a storefront should display.
   */
  public async available(productId: string): Promise<number> {
    const [onHand, reserved] = await Promise.all([
      this.onHand(productId),
      this.reserved(productId),
    ]);
    return onHand - reserved;
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
    options: { orderId: string; ttlMinutes?: number },
  ): Promise<StockReservationEntity> {
    // A fast pre-check only: it rejects the obviously impossible without
    // writing anything, but two racers can both pass it. The claim below is
    // what actually decides.
    const available = await this.available(productId);
    if (available < quantity) {
      throw new InsufficientStockError(productId, quantity, available);
    }

    const ttl = options.ttlMinutes ?? StockService.RESERVATION_TTL_MINUTES;
    const hold = await this.reservations.create({
      productId,
      quantity,
      orderId: options.orderId,
      status: "held",
      expiresAt: new Date(
        this.dateTime.nowMillis() + ttl * 60_000,
      ).toISOString(),
    });

    if (!(await this.holdFits(productId, hold.id))) {
      await this.reservations.updateById(hold.id, { status: "released" });
      throw new InsufficientStockError(
        productId,
        quantity,
        Math.max(0, await this.available(productId)),
      );
    }

    return hold;
  }

  /**
   * Whether a hold just written is one the stock can actually back.
   *
   * Every live hold is read back in one order every racer computes the same
   * way, and the quantities are summed up to and including this one. The hold
   * survives if that running total still fits within on-hand - so N racers for
   * M units leave exactly as many holds standing as M allows, and the ones
   * that lose are the ones that arrived last.
   *
   * A hold that is no longer in the list at all (expired or released between
   * the write and this read) loses too: it is no longer holding anything.
   */
  protected async holdFits(
    productId: string,
    holdId: string,
  ): Promise<boolean> {
    const now = this.dateTime.nowISOString();
    const [onHand, holds] = await Promise.all([
      this.onHand(productId),
      this.reservations.findMany({
        where: {
          productId: { eq: productId },
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
   * Give up an order's holds — the payment failed, or the buyer walked away.
   * Idempotent: a hold already consumed or released is left alone.
   */
  public async releaseFor(orderId: string): Promise<void> {
    const holds = await this.reservations.findMany({
      where: { orderId: { eq: orderId }, status: { eq: "held" } },
    });
    for (const hold of holds) {
      await this.reservations.updateById(hold.id, { status: "released" });
    }
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
   * The availability check here is against **on-hand**, not available: the order
   * being settled is precisely the one whose hold made those units unavailable
   * to others, so counting its own hold against it would refuse every reserved
   * sale.
   *
   * @throws InsufficientStockError when the units are not physically there.
   */
  public async recordSale(
    productId: string,
    quantity: number,
    context: { orderId?: string } = {},
  ): Promise<void> {
    // Fast pre-check, same as `reserve`: it rejects the obviously impossible
    // without writing, but two racers can both pass it.
    const onHand = await this.onHand(productId);
    if (onHand < quantity) {
      throw new InsufficientStockError(productId, quantity, onHand);
    }

    const movement = await this.movements.create({
      productId,
      delta: -quantity,
      reason: "sale",
      orderId: context.orderId,
    });

    if (!(await this.movementFits(productId, movement.id))) {
      await this.movements.deleteById(movement.id);
      throw new InsufficientStockError(
        productId,
        quantity,
        Math.max(0, await this.onHand(productId)),
      );
    }

    if (context.orderId) {
      await this.consumeHold(context.orderId, productId, quantity);
    }
  }

  /**
   * Whether a sale just written is one the ledger can actually back.
   *
   * The whole ledger is replayed in one order every racer computes the same
   * way, and the balance is summed up to and including this movement. The sale
   * survives if the running balance never went negative at its own row.
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
    movementId: string,
  ): Promise<boolean> {
    const movements = await this.movements.findMany({
      where: { productId: { eq: productId } },
      orderBy: [
        { column: "createdAt", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
      columns: ["id", "delta"],
    });

    let running = 0;
    for (const movement of movements) {
      running += movement.delta;
      if (movement.id === movementId) {
        return running >= 0;
      }
    }

    return false;
  }

  /**
   * Add stock. `reason` distinguishes a delivery from a customer return, which
   * the two consumers of this ledger (margin reporting, returns) need apart.
   */
  public async recordIntake(
    productId: string,
    quantity: number,
    options: { reason?: "intake" | "return"; note?: string } = {},
  ): Promise<void> {
    await this.movements.create({
      productId,
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
   * book being wrong — breakage, a miscount, a unit written off. Rolling them
   * together would make "how much did we take in this quarter" unanswerable.
   *
   * `delta` is signed and must not be zero; a zero movement is a row that says
   * nothing and still shows up in the ledger an operator reads.
   */
  public async recordAdjustment(
    productId: string,
    delta: number,
    options: { note?: string } = {},
  ): Promise<void> {
    if (delta === 0) {
      throw new AlephaError("A stock adjustment cannot be zero.");
    }
    await this.movements.create({
      productId,
      delta,
      reason: "adjustment",
      note: options.note,
    });
  }

  /**
   * The product's ledger, newest first — every movement and why it happened.
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
   * Put back what a cancelled or refunded order had taken, and drop any hold it
   * still carried.
   */
  public async releaseOrder(orderId: string): Promise<void> {
    const sales = await this.movements.findMany({
      where: { orderId: { eq: orderId }, reason: { eq: "sale" } },
    });
    for (const sale of sales) {
      await this.movements.create({
        productId: sale.productId,
        delta: -sale.delta,
        reason: "return",
        orderId,
        note: `Release of order ${orderId}`,
      });
    }
    await this.releaseFor(orderId);
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
  ): Promise<void> {
    const holds = await this.reservations.findMany({
      where: {
        orderId: { eq: orderId },
        productId: { eq: productId },
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
