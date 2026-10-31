import { $inject } from "alepha";

import type {
  CartDiscount,
  CartDiscountContext,
  CartDiscountSource,
} from "../../cart/providers/CartDiscountProvider.ts";
import { PromotionRefusedError } from "../../errors/CommerceError.ts";
import type { PromotionEntity } from "../entities/promotions.ts";
import { PromotionService } from "../services/PromotionService.ts";

/**
 * Answers the cart's discount question from the promotion tables: the plugin
 * implements what the cart declares, and the arrow never points the other way.
 */
export class PromotionDiscountSource implements CartDiscountSource {
  protected readonly promotions = $inject(PromotionService);

  public async evaluate(
    context: CartDiscountContext,
  ): Promise<CartDiscount | undefined> {
    const judged = {
      itemsTotal: context.itemsTotal,
      userId: context.cart.userId,
    };

    if (context.code) {
      const promotion = await this.promotions.findByCode(context.code);
      if (!promotion) {
        throw new PromotionRefusedError({
          code: context.code,
          reason: "invalid",
        });
      }
      await this.promotions.assertApplies(promotion, judged);
      return this.discountOf(promotion, context.itemsTotal);
    }

    let best: CartDiscount | undefined;
    for (const promotion of await this.promotions.automatic()) {
      if (!(await this.applies(promotion, judged))) {
        continue;
      }
      const discount = this.discountOf(promotion, context.itemsTotal);
      if (!best || discount.amount > best.amount) {
        best = discount;
      }
    }
    return best;
  }

  public async redeem(
    discount: CartDiscount,
    customer: { orderId: string; userId?: string; email?: string },
  ): Promise<void> {
    await this.promotions.redeem(discount.promotionId, customer);
  }

  /**
   * An automatic discount that does not apply is not a refusal: nobody asked
   * for it.
   */
  protected async applies(
    promotion: PromotionEntity,
    judged: { itemsTotal: number; userId?: string },
  ): Promise<boolean> {
    try {
      await this.promotions.assertApplies(promotion, judged);
      return true;
    } catch (error) {
      if (error instanceof PromotionRefusedError) {
        return false;
      }
      throw error;
    }
  }

  protected discountOf(
    promotion: PromotionEntity,
    itemsTotal: number,
  ): CartDiscount {
    return {
      promotionId: promotion.id,
      code: promotion.code,
      label: promotion.name,
      amount: this.promotions.amountOff(promotion, itemsTotal),
      freeShipping: promotion.kind === "freeShipping",
    };
  }
}
