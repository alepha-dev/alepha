import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { type ProductEntity, products } from "../../entities/products.ts";
import type { ProductVariantEntity } from "../../entities/productVariants.ts";
import {
  CommerceError,
  PromotionRefusedError,
} from "../../errors/CommerceError.ts";
import { LineConfigService } from "../../services/LineConfigService.ts";
import { VariantService } from "../../services/VariantService.ts";
import { type CartItemEntity, cartItems } from "../entities/cartItems.ts";
import { type CartEntity, carts } from "../entities/carts.ts";
import {
  type CartDiscount,
  CartDiscountProvider,
} from "../providers/CartDiscountProvider.ts";

/**
 * A cart priced against the catalog as it stands right now.
 */
export interface PricedCart {
  cart: CartEntity;
  lines: PricedCartLine[];
  /**
   * What the lines come to before any discount.
   */
  itemsTotal: number;
  /**
   * Taken off the items, tax included. `0` without a discount.
   */
  discountTotal: number;
  /**
   * Sum of the lines: what the items cost the buyer, after the discount.
   * Everything downstream reads this one, delivery thresholds included, since
   * VAT is owed on what is paid.
   */
  subtotal: number;
  currency: string;
  /**
   * The discount this cart earned.
   */
  discount?: CartDiscount;
  /**
   * What the buyer reads for it.
   */
  discountLabel?: string;
  /**
   * The code at work, when the discount came from one.
   */
  promotionCode?: string;
  /**
   * Why the applied code stopped applying. The cart prices without it, and
   * `pay()` refuses rather than charge a figure the buyer did not see.
   */
  codeRefusal?: PromotionRefusedError;
}

export interface PricedCartLine {
  item: CartItemEntity;
  /**
   * The line's id: what a storefront names to change or remove it, since two
   * lines of one product (two slots) cannot be told apart by the product.
   */
  lineId: string;
  productId: string;
  /**
   * The variant chosen, on a product sold by variant.
   */
  variantId?: string;
  /**
   * What this line chooses beyond the product (the court and the interval),
   * as validated when it was added.
   */
  lineConfig?: Record<string, any>;
  name: string;
  /**
   * The variant's option values as a buyer reads them: `Bleu / M`.
   */
  variantLabel?: string;
  sku?: string;
  kind: string;
  unitPrice: number;
  /**
   * The product's VAT rate in basis points, or unset for the seller default.
   */
  rateBps?: number;
  quantity: number;
  /**
   * This line's share of the cart's discount.
   */
  discount: number;
  /**
   * `unitPrice * quantity - discount`. The unit price comes from the kind's
   * `unitPrice` hook when it has one, else from the catalogue, and never from
   * the client.
   */
  lineTotal: number;
  /**
   * The variant's image, else the first product image, so a cart can show a
   * thumbnail without a second query.
   */
  image?: string;
}

/**
 * Baskets, and the one authoritative way to price them.
 *
 * {@link price} is deliberately the only place a cart total is computed. The
 * storefront preview and the checkout that turns the cart into an order both go
 * through it, because two implementations of the same arithmetic is how a
 * customer ends up charged a different figure from the one they were shown.
 */
export class CartService {
  /**
   * How long an untouched cart survives.
   */
  public static readonly TTL_DAYS = 30;

  protected readonly cartRepo = $repository(carts);
  protected readonly itemRepo = $repository(cartItems);
  protected readonly productRepo = $repository(products);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly lines = $inject(LineConfigService);
  protected readonly variants = $inject(VariantService);
  protected readonly discounts = $inject(CartDiscountProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Find the cart for a token, creating it if this visitor has none yet.
   */
  public async resolve(
    token: string,
    options: { userId?: string } = {},
  ): Promise<CartEntity> {
    const existing = await this.cartRepo.findOne({
      where: { token: { eq: token } },
    });
    if (existing) {
      return existing;
    }
    return this.cartRepo.create({
      token,
      userId: options.userId,
      expiresAt: this.expiry(),
    });
  }

  /**
   * The cart behind a token, if there is one. A read: unlike {@link resolve} it
   * mints nothing.
   */
  public async findByToken(token: string): Promise<CartEntity | undefined> {
    return this.cartRepo.findOne({ where: { token: { eq: token } } });
  }

  /**
   * The cart a signed-in customer already owns, if any.
   *
   * Most recently touched first: a customer who checked out from one device
   * and came back on another has more than one, and the live one is the one
   * they last touched.
   */
  public async forUser(userId: string): Promise<CartEntity | undefined> {
    // `findMany` rather than `findOne`, which takes no `orderBy` - and the
    // order is the point: without it "the user's cart" is whichever row the
    // database happened to return.
    const [cart] = await this.cartRepo.findMany({
      where: { userId: { eq: userId } },
      orderBy: { column: "updatedAt", direction: "desc" },
      limit: 1,
    });
    return cart;
  }

  /**
   * Attach an anonymous cart to the customer who just signed in.
   *
   * This is what makes "my orders" work: the cart's `userId` is copied to the
   * checkout session and from there to the order, so a cart that never learned
   * who its owner was produced an order nobody owned.
   */
  public async claim(cartId: string, userId: string): Promise<CartEntity> {
    return this.cartRepo.updateById(cartId, { userId });
  }

  /**
   * Mint a token for a visitor who has none. The caller is responsible for
   * putting it in a signed cookie — this service never touches HTTP.
   */
  public newToken(): string {
    return this.crypto.randomText(32);
  }

  /**
   * Add a quantity of a product, merging with an existing line for the same
   * product and the same line config rather than creating a second one.
   *
   * `lineConfig` is untrusted: it is parsed and judged by the kind's handler
   * (`lineSchema`, `validateLine`) before anything is written, and refused
   * outright for a kind that takes none. Adding holds nothing, whatever the
   * kind: the hold is taken at `pay()`.
   *
   * On a product sold by variant, `variantId` is required and must be on sale.
   *
   * @throws InvalidLineError when the handler refuses the line, or the variant
   *   is missing, foreign or switched off.
   */
  public async add(
    cartId: string,
    productId: string,
    quantity = 1,
    lineConfig?: unknown,
    variantId?: string,
  ): Promise<CartItemEntity> {
    if (quantity < 1) {
      throw new CommerceError(`Quantity must be at least 1, got ${quantity}.`);
    }

    const product = await this.productRepo.findOne({
      where: { id: { eq: productId } },
    });
    if (!product?.published) {
      throw new CommerceError(`Product is not purchasable: ${productId}`);
    }

    const variant = await this.variants.resolve(product, variantId);
    const config = await this.lines.accept(product, lineConfig, quantity);
    const lineKey = await this.lineKey(config, variant?.id);

    const line = await this.itemRepo.findOne({
      where: {
        cartId: { eq: cartId },
        productId: { eq: productId },
        lineKey: { eq: lineKey },
      },
    });

    if (line) {
      // Judged again at the quantity the line is about to hold: a court
      // takes one booking per slot, however many adds it arrives in.
      await this.lines.accept(product, config, line.quantity + quantity);
      await this.touch(cartId);
      return this.itemRepo.updateById(line.id, {
        quantity: line.quantity + quantity,
      });
    }

    await this.touch(cartId);
    return this.itemRepo.create({
      cartId,
      productId,
      variantId: variant?.id,
      quantity,
      lineConfig: config,
      lineKey,
    });
  }

  /**
   * Set a line's quantity, or remove it when the quantity reaches zero.
   *
   * By line id, scoped to the cart: an id from another cart is ignored, so a
   * visitor cannot edit a stranger's basket by guessing one.
   */
  public async setQuantity(
    cartId: string,
    lineId: string,
    quantity: number,
  ): Promise<void> {
    const line = await this.itemRepo.findOne({
      where: { cartId: { eq: cartId }, id: { eq: lineId } },
    });
    if (!line) {
      return;
    }
    if (quantity <= 0) {
      await this.touch(cartId);
      await this.itemRepo.deleteById(line.id);
      return;
    }

    const product = await this.productRepo.findOne({
      where: { id: { eq: line.productId } },
    });
    if (product) {
      await this.lines.accept(product, line.lineConfig, quantity);
    }
    await this.touch(cartId);
    await this.itemRepo.updateById(line.id, { quantity });
  }

  public async remove(cartId: string, lineId: string): Promise<void> {
    await this.setQuantity(cartId, lineId, 0);
  }

  public async clear(cartId: string): Promise<void> {
    await this.itemRepo.deleteMany({ cartId: { eq: cartId } });
    await this.cartRepo.updateById(cartId, { promotionCode: null });
  }

  /**
   * Apply a discount code to the cart, refusing with the reason when it does
   * not apply to this basket.
   *
   * @throws PromotionRefusedError
   */
  public async applyCode(cartId: string, code: string): Promise<CartEntity> {
    const normalised = code.trim().toUpperCase();
    const { cart, itemsTotal } = await this.price(cartId);
    const discount = await this.discounts.evaluate({
      cart,
      itemsTotal,
      code: normalised,
    });
    if (!discount) {
      throw new PromotionRefusedError({ code: normalised, reason: "invalid" });
    }
    await this.touch(cartId);
    return this.cartRepo.updateById(cartId, { promotionCode: normalised });
  }

  public async removeCode(cartId: string): Promise<CartEntity> {
    await this.touch(cartId);
    return this.cartRepo.updateById(cartId, { promotionCode: null });
  }

  /**
   * Price a cart against the catalog as it stands now.
   *
   * A line that can no longer be sold is dropped from the result, silently,
   * because the alternative is a storefront that cannot render a cart at all:
   * a product unpublished or deleted since it was added, and a line its kind
   * now refuses (a slot whose start has passed). That is also what keeps cart
   * recovery, which mails these lines, from offering last week's slot.
   */
  public async price(cartId: string): Promise<PricedCart> {
    const cart = await this.cartRepo.getById(cartId);
    // In the order the lines were added: with several lines of one product
    // (two slots), a cart whose rows came back in any order would reshuffle
    // under the buyer's cursor.
    const items = await this.itemRepo.findMany({
      where: { cartId: { eq: cartId } },
      orderBy: [
        { column: "createdAt", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
    });

    if (items.length === 0) {
      return {
        cart,
        lines: [],
        itemsTotal: 0,
        discountTotal: 0,
        subtotal: 0,
        currency: "EUR",
      };
    }

    const productIds = [...new Set(items.map((i) => i.productId))];
    const found = await this.productRepo.findMany({
      where: { id: { inArray: productIds } },
    });
    const byId = new Map(found.map((p) => [p.id, p]));
    const variants = await this.variants.listForProducts(productIds);

    const lines: PricedCartLine[] = [];
    for (const item of items) {
      const product = byId.get(item.productId);
      if (!product?.published) {
        continue;
      }
      const sellable = await this.stillSellable(
        product,
        item,
        variants.filter((it) => it.productId === product.id),
      );
      if (sellable === false) {
        continue;
      }
      const { lineConfig, variant } = sellable;
      const unitPrice = await this.lines.unitPrice(
        product,
        lineConfig,
        variant,
      );
      lines.push({
        item,
        lineId: item.id,
        productId: product.id,
        variantId: variant?.id,
        lineConfig,
        name: product.name,
        variantLabel: variant && this.variants.label(product, variant),
        sku: variant?.sku,
        kind: product.kind,
        unitPrice,
        rateBps: product.vatRateBps,
        quantity: item.quantity,
        discount: 0,
        lineTotal: unitPrice * item.quantity,
        image: variant?.image ?? product.images[0],
      });
    }

    const itemsTotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    const { discount, codeRefusal } = await this.earned(cart, itemsTotal);
    this.applyDiscount(lines, discount?.amount ?? 0);

    return {
      cart,
      lines,
      itemsTotal,
      discountTotal: discount?.amount ?? 0,
      subtotal: lines.reduce((sum, l) => sum + l.lineTotal, 0),
      currency: lines[0] ? byId.get(lines[0].productId)!.currency : "EUR",
      discount,
      discountLabel: discount?.label,
      promotionCode: discount?.code,
      codeRefusal,
    };
  }

  /**
   * What this cart earns. A code that stopped applying is not a failure to
   * price: the cart still renders, without it, and says why.
   */
  protected async earned(
    cart: CartEntity,
    itemsTotal: number,
  ): Promise<{
    discount?: CartDiscount;
    codeRefusal?: PromotionRefusedError;
  }> {
    if (itemsTotal === 0) {
      return {};
    }
    try {
      return {
        discount: await this.discounts.evaluate({
          cart,
          itemsTotal,
          code: cart.promotionCode,
        }),
      };
    } catch (error) {
      if (!(error instanceof PromotionRefusedError) || !cart.promotionCode) {
        throw error;
      }
      return {
        discount: await this.discounts.evaluate({ cart, itemsTotal }),
        codeRefusal: error,
      };
    }
  }

  /**
   * Take the discount off the tax-inclusive lines, in proportion to what each
   * comes to, so VAT is computed on what is actually paid, rate by rate.
   *
   * Whole cents: every line takes the floor of its share, and what that leaves
   * goes one cent at a time to the lines with the largest remainders, so the
   * shares add up to the discount exactly.
   */
  protected applyDiscount(lines: PricedCartLine[], amount: number): void {
    const total = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    if (amount <= 0 || total <= 0) {
      return;
    }

    const shares = lines.map((line, index) => {
      const exact = (line.lineTotal * amount) / total;
      return { index, floor: Math.floor(exact), rest: exact % 1 };
    });
    let left = amount - shares.reduce((sum, s) => sum + s.floor, 0);
    for (const share of [...shares].sort((a, b) => b.rest - a.rest)) {
      const extra = left > 0 ? 1 : 0;
      left -= extra;
      const line = lines[share.index]!;
      line.discount = share.floor + extra;
      line.lineTotal -= line.discount;
    }
  }

  /**
   * Fold an anonymous cart into the one belonging to a user who just signed in.
   *
   * Each line goes through {@link add}, line config included, so it is judged
   * again. A line that can no longer be sold (a product unpublished, a slot
   * already past) is left behind rather than failing the sign-in that
   * triggered the merge.
   */
  public async merge(fromCartId: string, toCartId: string): Promise<void> {
    const lines = await this.itemRepo.findMany({
      where: { cartId: { eq: fromCartId } },
    });
    for (const line of lines) {
      try {
        await this.add(
          toCartId,
          line.productId,
          line.quantity,
          line.lineConfig,
          line.variantId,
        );
      } catch (error) {
        if (!(error instanceof CommerceError)) {
          throw error;
        }
      }
    }
    await this.cartRepo.deleteById(fromCartId);
  }

  /**
   * The line key of a validated line config and its variant: `""` with
   * neither, else the sha-256 of their canonical JSON (keys sorted at every
   * depth), so the same choice written in a different key order is the same
   * line and two variants of a product are two.
   */
  public async lineKey(
    lineConfig: Record<string, any> | undefined,
    variantId?: string,
  ): Promise<string> {
    if (lineConfig === undefined && variantId === undefined) {
      return "";
    }
    return this.crypto.hash(
      JSON.stringify(
        this.canonical(variantId ? { lineConfig, variantId } : lineConfig),
      ),
    );
  }

  protected canonical(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((it) => this.canonical(it));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, this.canonical((value as any)[key])]),
      );
    }
    return value;
  }

  /**
   * The line's config and variant if they still sell, `false` when the kind
   * refuses it now or the variant was switched off. Only a refusal (a
   * `CommerceError`) drops the line; any other failure is a fault and
   * propagates.
   */
  protected async stillSellable(
    product: ProductEntity,
    item: CartItemEntity,
    variants: ProductVariantEntity[],
  ): Promise<
    | {
        lineConfig: Record<string, any> | undefined;
        variant: ProductVariantEntity | undefined;
      }
    | false
  > {
    try {
      return {
        variant: this.variants.pick(product, variants, item.variantId),
        lineConfig: await this.lines.accept(
          product,
          item.lineConfig,
          item.quantity,
        ),
      };
    } catch (error) {
      if (error instanceof CommerceError) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Push the expiry out. Called on every mutation.
   */
  protected async touch(cartId: string): Promise<void> {
    await this.cartRepo.updateById(cartId, { expiresAt: this.expiry() });
  }

  protected expiry(): string {
    const ms = CartService.TTL_DAYS * 24 * 60 * 60 * 1000;
    return new Date(this.dateTime.nowMillis() + ms).toISOString();
  }
}
