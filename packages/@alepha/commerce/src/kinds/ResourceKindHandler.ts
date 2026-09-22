import { $inject, type ZType } from "alepha";

import type { OrderItemEntity } from "../entities/orderItems.ts";
import type { ProductEntity } from "../entities/products.ts";
import { ProductKindHandler } from "../interfaces/ProductKindHandler.ts";
import type { ClaimLockKey } from "../services/ClaimLock.ts";
import {
  type ResourceClaim,
  ResourceService,
} from "../services/ResourceService.ts";

/**
 * The kind that binds a sale to an interval on a named resource: a padel
 * court, a train seat, a hotel room, a coworking desk, a place on a course.
 * This is what makes all of them the same code.
 *
 * An application extends it and supplies three things: what a line chooses
 * ({@link lineSchema}), whether this product can sell it
 * ({@link validateLine}), and which claims a line makes ({@link resolve}).
 * The holding, the selling, the all-or-nothing and the idempotency are done
 * here, on `ResourceService`.
 *
 * ```ts
 * class CourtKind extends ResourceKindHandler {
 *   kind = "court";
 *   configSchema = z.object({ courts: z.array(z.text()), minutes: z.integer() });
 *   lineSchema = z.object({ resourceId: z.text(), startsAt: z.text(), endsAt: z.text() });
 *
 *   async validateLine(product, line, quantity) {
 *     // the court is one of the product's, the interval is on its grid and
 *     // not past, and a court takes one booking: quantity 1
 *   }
 *
 *   resolve(item) {
 *     const line = item.lineConfig as CourtLine;
 *     return [{ ...line, capacity: 1 }];
 *   }
 * }
 * ```
 *
 * ### The product is not the slot
 *
 * "Padel, 90 minutes" is the product. The court and the interval are chosen
 * when the line is added to the cart, and live on the line (`lineConfig`), not
 * on the product. Modelling each slot as its own product row is the mistake
 * this design exists to prevent: the catalogue becomes unbounded (every court
 * times every start time times every day), and it breaks the moment a court
 * is swapped for another, because the sold thing and the catalogue row were
 * the same row.
 *
 * ### A list of claims, from day one
 *
 * {@link resolve} returns a list. A court claims one interval; a seat sold
 * from A to C over a train running A to B to C claims one per leg; a
 * tournament entry may claim several courts. Each claim names its own
 * `capacity`, because the handler is the only place that knows what the
 * resource is, and its own `quantity`, which defaults to the line's.
 *
 * ### What this class guarantees
 *
 * - **All or nothing, without trusting the transaction.** On Postgres a throw
 *   rolls the order back, but D1 has no interactive transaction. So when one
 *   of a line's claims loses, the ones this line already took are released
 *   before the error is rethrown, on every database.
 * - **Idempotent on `item.id`**, through the claims' `orderItemId`: a line
 *   whose claims are already held is not held twice, and a line whose claims
 *   are already consumed is not sold twice, `materialise` included.
 * - **A sale with no hold still sells.** A counter sale is created `paid` and
 *   never reserves, and a hold can expire before its capture lands: `fulfil`
 *   then claims and consumes in one step, through the same fit check.
 */
export abstract class ResourceKindHandler extends ProductKindHandler {
  /**
   * The shape of `item.lineConfig` for this kind: which resource, and when.
   */
  abstract override readonly lineSchema: ZType;

  /**
   * Refuse a line this product cannot sell. **This is the security
   * boundary**: the line config comes from the buyer, and without this check
   * a client books any resource for any interval at the product's price.
   * Check that the resource belongs to this product, that the interval
   * matches the product's duration and grid, that it has not started, and
   * that the quantity is one the resource takes (a court: 1).
   *
   * Throw an `InvalidLineError`.
   */
  abstract override validateLine(
    product: ProductEntity,
    lineConfig: Record<string, any>,
    quantity: number,
  ): Promise<void>;

  /**
   * The claims one order line makes, read from `item.lineConfig`: one per
   * resource and interval, each with the capacity of its resource.
   */
  abstract resolve(item: OrderItemEntity): ResourceClaim[];

  /**
   * Write the application's own operational row once the line is sold: a
   * booking, a seat assignment, a room allocation. The order is the contract,
   * this row is the projection a planning screen reads.
   *
   * Called once per item, after every claim is consumed. Not called again on
   * a redelivery that finds the line already sold; but on D1, where a failure
   * after the claims are consumed cannot be rolled back, a later delivery can
   * reach it again, so keep it idempotent on `item.id`.
   */
  materialise?(item: OrderItemEntity): Promise<void>;

  protected readonly resources = $inject(ResourceService);

  /**
   * One lock key per resource the line claims, so an order can take every
   * lock it needs up front, in one global order.
   */
  public lockKeys(item: OrderItemEntity): ClaimLockKey[] {
    return this.resolve(item).map((claim) => ({
      namespace: ResourceService.LOCK_NAMESPACE,
      key: claim.resourceId,
    }));
  }

  /**
   * Hold every claim of the line while its payment is in flight, or none.
   */
  public async reserve(item: OrderItemEntity): Promise<void> {
    const claims = this.claimsOf(item);
    const taken = await this.resources.claimsOfItem(item.id);
    if (taken.some((it) => it.status !== "released")) {
      // Already held (or sold) for this line: never twice.
      return;
    }

    try {
      for (const claim of claims) {
        await this.resources.reserve(claim.resourceId, {
          ...claim,
          orderId: item.orderId,
          orderItemId: item.id,
        });
      }
    } catch (error) {
      await this.resources.releaseItem(item.id);
      throw error;
    }
  }

  /**
   * Sell every claim of the line: consume its holds, or claim and consume
   * where there is none. Then {@link materialise}.
   */
  public async fulfil(item: OrderItemEntity): Promise<void> {
    const claims = this.claimsOf(item);
    const taken = await this.resources.claimsOfItem(item.id);
    const sold = taken.filter((it) => it.status === "consumed");
    if (claims.length > 0 && sold.length >= claims.length) {
      // A redelivery: the line is already sold.
      return;
    }

    try {
      for (const claim of claims) {
        await this.resources.commit(claim, {
          orderId: item.orderId,
          orderItemId: item.id,
        });
      }
    } catch (error) {
      await this.resources.releaseItem(item.id);
      throw error;
    }

    await this.materialise?.(item);
  }

  /**
   * {@link resolve}, with each claim's quantity defaulted to the line's.
   */
  protected claimsOf(
    item: OrderItemEntity,
  ): Array<ResourceClaim & { quantity: number }> {
    return this.resolve(item).map((claim) => ({
      ...claim,
      quantity: claim.quantity ?? item.quantity,
    }));
  }
}
