import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { stockMovements } from "../entities/stockMovements.ts";
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
 * enough, both write. Reading the sum **inside** the transaction that writes
 * closes that window, so every mutating method here expects to be called
 * within one.
 */
export class StockService {
  /** How long a hold survives without a settled payment. */
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
    const available = await this.available(productId);
    if (available < quantity) {
      throw new InsufficientStockError(productId, quantity, available);
    }

    const ttl = options.ttlMinutes ?? StockService.RESERVATION_TTL_MINUTES;
    return this.reservations.create({
      productId,
      quantity,
      orderId: options.orderId,
      status: "held",
      expiresAt: new Date(
        this.dateTime.nowMillis() + ttl * 60_000,
      ).toISOString(),
    });
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
    const onHand = await this.onHand(productId);
    if (onHand < quantity) {
      throw new InsufficientStockError(productId, quantity, onHand);
    }

    await this.movements.create({
      productId,
      delta: -quantity,
      reason: "sale",
      orderId: context.orderId,
    });

    if (context.orderId) {
      await this.consumeHold(context.orderId, productId, quantity);
    }
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
