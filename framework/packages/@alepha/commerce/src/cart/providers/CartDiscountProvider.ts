import type { CartEntity } from "../entities/carts.ts";

/**
 * What a cart is priced against: enough to judge a promotion, nothing about
 * the lines, since a discount applies to the basket.
 */
export interface CartDiscountContext {
  cart: CartEntity;
  /**
   * The lines' sum before any discount.
   */
  itemsTotal: number;
  /**
   * The code the buyer applied, normalised. Unset: only what applies on its
   * own can.
   */
  code?: string;
}

/**
 * A discount a cart earned.
 */
export interface CartDiscount {
  /**
   * Opaque to the cart: handed back to {@link CartDiscountProvider.redeem}.
   */
  promotionId: string;
  code?: string;
  /**
   * What the buyer reads.
   */
  label: string;
  /**
   * Off the items, tax included, in the smallest currency unit. Never more
   * than `itemsTotal`.
   */
  amount: number;
  /**
   * Delivery is on the house.
   */
  freeShipping: boolean;
}

/**
 * Something that can answer the cart's discount question.
 */
export interface CartDiscountSource {
  /**
   * The discount this cart earns, or `undefined` when none applies.
   *
   * @throws PromotionRefusedError when `code` was given and does not apply: a
   *   buyer who typed a code is owed the reason.
   */
  evaluate(context: CartDiscountContext): Promise<CartDiscount | undefined>;

  /**
   * Spend one use of a discount on an order, or refuse: this is the moment a
   * usage limit is decided, because two buyers can both see a last use.
   *
   * @throws PromotionRefusedError
   */
  redeem(
    discount: CartDiscount,
    customer: { orderId: string; userId?: string; email?: string },
  ): Promise<void>;
}

/**
 * Where a cart asks whether it earned a discount.
 *
 * Most consumers of the cart have no promotions, and a hard dependency would
 * put two promotion tables in their migrations, so `@alepha/commerce/promotions`
 * plugs in here.
 *
 * ### Why a slot and not a substitution
 *
 * For the reason `OrderDocumentsProvider` is one: `shipping` substitutes into
 * the checkout, a module wires its services as it registers, and two plugins
 * that both substitute cannot be ordered. The second gets
 * `TooLateSubstitutionError`. Nothing is substituted here, so the order the
 * modules are wired in cannot matter.
 */
export class CartDiscountProvider {
  protected source?: CartDiscountSource;

  /**
   * Plug the discounts in, from a module's `register` hook.
   */
  public use(source: CartDiscountSource): void {
    this.source = source;
  }

  public async evaluate(
    context: CartDiscountContext,
  ): Promise<CartDiscount | undefined> {
    return this.source?.evaluate(context);
  }

  public async redeem(
    discount: CartDiscount,
    customer: { orderId: string; userId?: string; email?: string },
  ): Promise<void> {
    await this.source?.redeem(discount, customer);
  }
}
