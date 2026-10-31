import { $hook, $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, type Page } from "alepha/orm";

import {
  PromotionInUseError,
  PromotionRefusedError,
} from "../../errors/CommerceError.ts";
import { ClaimLock } from "../../services/ClaimLock.ts";
import { promotionRedemptions } from "../entities/promotionRedemptions.ts";
import {
  type PromotionEntity,
  type PromotionKind,
  promotions,
} from "../entities/promotions.ts";

export interface PromotionInput {
  name: string;
  code?: string;
  kind: PromotionKind;
  value?: number;
  minSubtotal?: number;
  startsAt?: string;
  endsAt?: string;
  usageLimit?: number;
  usagePerCustomer?: number;
  active?: boolean;
}

/**
 * Promotions, and the rule that decides whether one applies.
 *
 * {@link assertApplies} is a read, and what a cart sees. {@link redeem} is the
 * write that spends a use, and the only decision a usage limit can rest on.
 */
export class PromotionService {
  /**
   * First key of the per-promotion claim lock. See `ClaimLock`.
   */
  public static readonly LOCK_NAMESPACE = "alepha:commerce:promotion";

  protected readonly repo = $repository(promotions);
  protected readonly redemptions = $repository(promotionRedemptions);
  protected readonly lock = $inject(ClaimLock);
  protected readonly dateTime = $inject(DateTimeProvider);

  public async create(data: PromotionInput): Promise<PromotionEntity> {
    return this.repo.create({ ...data, code: this.normalise(data.code) });
  }

  public async update(
    id: string,
    data: Partial<PromotionInput>,
  ): Promise<PromotionEntity> {
    return this.repo.updateById(id, {
      ...data,
      ...(data.code !== undefined ? { code: this.normalise(data.code) } : {}),
    });
  }

  /**
   * Remove a promotion nobody has used. One that has been used is switched off
   * instead: its redemptions are the record of who had what.
   *
   * @throws PromotionInUseError
   */
  public async delete(id: string): Promise<void> {
    const used = await this.usageOf(id);
    if (used > 0) {
      throw new PromotionInUseError({ promotionId: id, used });
    }
    await this.repo.deleteById(id);
  }

  public async getById(id: string): Promise<PromotionEntity> {
    return this.repo.getById(id);
  }

  public async findByCode(code: string): Promise<PromotionEntity | undefined> {
    return this.repo.findOne({
      where: { code: { eq: this.normalise(code)! } },
    });
  }

  /**
   * Back-office listing, newest first.
   */
  public async list(
    query: { size?: number; page?: number } = {},
  ): Promise<Page<PromotionEntity>> {
    return this.repo.paginate(
      { sort: "-createdAt", ...query },
      {},
      { count: true },
    );
  }

  /**
   * The discounts that need no code and are switched on. Judged one by one by
   * the caller: dates and limits are not worth a query of their own on a table
   * this small.
   */
  public async automatic(): Promise<PromotionEntity[]> {
    return this.repo.findMany({
      where: { code: { isNull: true }, active: { eq: true } },
    });
  }

  public async usageOf(promotionId: string): Promise<number> {
    return this.redemptions.count({ promotionId: { eq: promotionId } });
  }

  /**
   * Refuse a promotion this basket cannot have, with the reason a buyer is
   * owed. A customer who is known is checked against their own limit; a guest
   * has no email yet at this stage, and is checked at {@link redeem}.
   *
   * @throws PromotionRefusedError
   */
  public async assertApplies(
    promotion: PromotionEntity,
    context: { itemsTotal: number; userId?: string },
  ): Promise<void> {
    const code = promotion.code ?? promotion.name;
    const now = this.dateTime.nowISOString();

    if (!promotion.active || (promotion.endsAt && promotion.endsAt < now)) {
      throw new PromotionRefusedError({ code, reason: "expired" });
    }
    if (promotion.startsAt && promotion.startsAt > now) {
      throw new PromotionRefusedError({ code, reason: "notYet" });
    }
    if (
      promotion.minSubtotal !== undefined &&
      context.itemsTotal < promotion.minSubtotal
    ) {
      throw new PromotionRefusedError({ code, reason: "minimum" });
    }
    await this.assertUsesLeft(promotion, { userId: context.userId });
  }

  /**
   * What a promotion takes off these items: never more than they come to.
   */
  public amountOff(promotion: PromotionEntity, itemsTotal: number): number {
    if (promotion.kind === "percent") {
      return Math.min(
        itemsTotal,
        Math.round((itemsTotal * promotion.value) / 10000),
      );
    }
    if (promotion.kind === "amount") {
      return Math.min(itemsTotal, promotion.value);
    }
    return 0;
  }

  /**
   * Spend one use of a promotion on an order.
   *
   * Through the claim lock, like stock and for the same reason: two buyers can
   * both read a last use. Under the lock the check decides. Without one the
   * row is written first and replayed, so that of N racers exactly the limit
   * keep theirs.
   *
   * @throws PromotionRefusedError
   */
  public async redeem(
    promotionId: string,
    customer: { orderId: string; userId?: string; email?: string },
  ): Promise<void> {
    const promotion = await this.repo.getById(promotionId);
    const email = customer.email?.trim().toLowerCase();

    await this.lock.run(
      { namespace: PromotionService.LOCK_NAMESPACE, key: promotionId },
      async (locked) => {
        await this.assertUsesLeft(promotion, {
          userId: customer.userId,
          email,
        });

        const row = await this.redemptions.create({
          promotionId,
          orderId: customer.orderId,
          userId: customer.userId,
          email,
        });

        if (!locked) {
          await this.replay(promotion, row.id, customer.userId, email);
        }
      },
    );
  }

  /**
   * An order that never happened spent nothing. Idempotent.
   */
  public async release(orderId: string): Promise<void> {
    await this.redemptions.deleteMany({ orderId: { eq: orderId } });
  }

  protected readonly onOrderCancelled = $hook({
    on: "commerce:order:cancelled",
    handler: async (event) => {
      await this.release(event.orderId);
    },
  });

  protected async assertUsesLeft(
    promotion: PromotionEntity,
    customer: { userId?: string; email?: string },
  ): Promise<void> {
    const code = promotion.code ?? promotion.name;

    if (
      promotion.usageLimit !== undefined &&
      (await this.usageOf(promotion.id)) >= promotion.usageLimit
    ) {
      throw new PromotionRefusedError({ code, reason: "usedUp" });
    }

    if (promotion.usagePerCustomer !== undefined) {
      const mine = await this.usageBy(promotion.id, customer);
      if (mine >= promotion.usagePerCustomer) {
        throw new PromotionRefusedError({ code, reason: "alreadyUsed" });
      }
    }
  }

  protected async usageBy(
    promotionId: string,
    customer: { userId?: string; email?: string },
  ): Promise<number> {
    const who = this.customerFilter(customer);
    if (who.length === 0) {
      return 0;
    }
    return this.redemptions.count({
      promotionId: { eq: promotionId },
      or: who,
    });
  }

  protected customerFilter(customer: { userId?: string; email?: string }) {
    return [
      ...(customer.userId ? [{ userId: { eq: customer.userId } }] : []),
      ...(customer.email ? [{ email: { eq: customer.email } }] : []),
    ];
  }

  /**
   * Keep a redemption just written only if the ones before it leave room, on a
   * database where the lock does not exist. See `StockService.holdFits` for why
   * `(createdAt, id)` is the order of writing there.
   */
  protected async replay(
    promotion: PromotionEntity,
    redemptionId: string,
    userId?: string,
    email?: string,
  ): Promise<void> {
    const code = promotion.code ?? promotion.name;
    const position = async (who: Array<Record<string, any>>) => {
      const rows = await this.redemptions.findMany({
        where: {
          promotionId: { eq: promotion.id },
          ...(who.length > 0 ? { or: who } : {}),
        },
        orderBy: [
          { column: "createdAt", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        columns: ["id"],
      });
      return rows.findIndex((row) => row.id === redemptionId);
    };

    const refuse = async (reason: "usedUp" | "alreadyUsed") => {
      await this.redemptions.deleteById(redemptionId);
      throw new PromotionRefusedError({ code, reason });
    };

    if (
      promotion.usageLimit !== undefined &&
      (await position([])) >= promotion.usageLimit
    ) {
      await refuse("usedUp");
    }
    if (
      promotion.usagePerCustomer !== undefined &&
      (await position(this.customerFilter({ userId, email }))) >=
        promotion.usagePerCustomer
    ) {
      await refuse("alreadyUsed");
    }
  }

  protected normalise(code?: string): string | undefined {
    return code?.trim().toUpperCase() || undefined;
  }
}
