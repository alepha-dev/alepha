import { $inject, Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, DatabaseProvider, type Page, sql } from "alepha/orm";

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

  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly db = $inject(DatabaseProvider);
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
    return this.claim(productId, async (locked) => {
      // Under the lock this check is the decision. Without it, it only
      // rejects the obviously impossible before anything is written: two
      // racers can both pass it, and the replay below decides.
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

      if (!locked && !(await this.holdFits(productId, hold.id))) {
        await this.reservations.updateById(hold.id, { status: "released" });
        throw new InsufficientStockError(
          productId,
          quantity,
          Math.max(0, await this.available(productId)),
        );
      }

      return hold;
    });
  }

  /**
   * Run one claim on a product's stock so that no other claim on the same
   * product decides at the same time, and tell it whether its own check is
   * the decision.
   *
   * On Postgres the claim runs in a transaction - the caller's, when there is
   * one - holding `pg_advisory_xact_lock` on the product. Its check then sees
   * every claim that committed before it, and no other claim on the product
   * can check until this one commits: `locked` is true and the check decides.
   * The lock outlives the claim until the transaction's COMMIT, never less,
   * which is exactly what makes the next claim's read include this one's row.
   *
   * Two conditions come with the lock:
   *
   * - READ COMMITTED (the default) or SERIALIZABLE. REPEATABLE READ keeps the
   *   snapshot taken before the wait, so the check misses every claim that
   *   committed meanwhile and oversells; it is refused rather than trusted.
   *   SERIALIZABLE is safe but turns every contended claim into a
   *   serialization failure for the caller to retry.
   * - Locks taken in one order when a transaction claims several products,
   *   or two of them can each hold the lock the other waits for. That is why
   *   `OrderService` walks an order's lines by product id.
   *
   * Everywhere else `locked` is false and the claim must replay: see
   * {@link holdFits} and {@link movementFits}.
   */
  protected async claim<R>(
    productId: string,
    decide: (locked: boolean) => Promise<R>,
  ): Promise<R> {
    if (this.db.dialect !== "postgresql" || !this.db.supportsTransactions) {
      return decide(false);
    }

    return this.db.transactional(async () => {
      const tx = this.alepha.get("alepha.orm.tx");
      if (!tx) {
        throw new AlephaError(
          `No transaction to hold the stock lock on product ${productId} in.`,
        );
      }

      const [row] = await tx.execute(sql`
        SELECT
          pg_advisory_xact_lock(
            hashtext(${StockService.LOCK_NAMESPACE}),
            hashtext(${productId})
          ),
          current_setting('transaction_isolation') AS isolation`);
      if (row?.isolation === "repeatable read") {
        throw new AlephaError(
          `Stock for product ${productId} cannot be claimed under REPEATABLE READ: the transaction would check a snapshot older than the claims it waited for. Use READ COMMITTED or SERIALIZABLE.`,
        );
      }

      return decide(true);
    });
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
    await this.claim(productId, async (locked) => {
      // The decision under the lock, a fast pre-check without it: same as
      // `reserve`.
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

      if (!locked && !(await this.movementFits(productId, movement.id))) {
        await this.movements.deleteById(movement.id);
        throw new InsufficientStockError(
          productId,
          quantity,
          Math.max(0, await this.onHand(productId)),
        );
      }

      // Inside the claim, so on Postgres the sale and the hold it uses up
      // commit together: no reader sees the units both sold and still held.
      if (context.orderId) {
        await this.consumeHold(context.orderId, productId, quantity);
      }
    });
  }

  /**
   * Whether a sale just written is one the ledger can actually back, on a
   * database where {@link claim} holds no lock.
   *
   * The whole ledger is replayed in the order it was written - see
   * {@link holdFits} for why `(createdAt, id)` is that order there and not on
   * Postgres - and the balance is summed up to and including this movement.
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
