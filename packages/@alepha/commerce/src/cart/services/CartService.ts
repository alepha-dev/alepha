import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { products } from "../../entities/products.ts";
import { CommerceError } from "../../errors/CommerceError.ts";
import { type CartItemEntity, cartItems } from "../entities/cartItems.ts";
import { type CartEntity, carts } from "../entities/carts.ts";

/**
 * A cart priced against the catalog as it stands right now.
 */
export interface PricedCart {
  cart: CartEntity;
  lines: PricedCartLine[];
  /**
   * Sum of the lines, in the smallest currency unit.
   */
  subtotal: number;
  currency: string;
}

export interface PricedCartLine {
  item: CartItemEntity;
  productId: string;
  name: string;
  kind: string;
  unitPrice: number;
  /**
   * The product's VAT rate in basis points, or unset for the seller default.
   */
  rateBps?: number;
  quantity: number;
  /**
   * `unitPrice * quantity`.
   */
  lineTotal: number;
  /**
   * First product image, so a cart can show a thumbnail without a second query.
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
   * Mint a token for a visitor who has none. The caller is responsible for
   * putting it in a signed cookie — this service never touches HTTP.
   */
  public newToken(): string {
    return this.crypto.randomText(32);
  }

  /**
   * Add a quantity of a product, merging with an existing line for the same
   * product rather than creating a second one.
   */
  public async add(
    cartId: string,
    productId: string,
    quantity = 1,
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

    const line = await this.itemRepo.findOne({
      where: { cartId: { eq: cartId }, productId: { eq: productId } },
    });

    await this.touch(cartId);

    if (line) {
      return this.itemRepo.updateById(line.id, {
        quantity: line.quantity + quantity,
      });
    }
    return this.itemRepo.create({ cartId, productId, quantity });
  }

  /**
   * Set a line's quantity, or remove it when the quantity reaches zero.
   */
  public async setQuantity(
    cartId: string,
    productId: string,
    quantity: number,
  ): Promise<void> {
    const line = await this.itemRepo.findOne({
      where: { cartId: { eq: cartId }, productId: { eq: productId } },
    });
    if (!line) {
      return;
    }
    await this.touch(cartId);
    if (quantity <= 0) {
      await this.itemRepo.deleteById(line.id);
      return;
    }
    await this.itemRepo.updateById(line.id, { quantity });
  }

  public async remove(cartId: string, productId: string): Promise<void> {
    await this.setQuantity(cartId, productId, 0);
  }

  public async clear(cartId: string): Promise<void> {
    const lines = await this.itemRepo.findMany({
      where: { cartId: { eq: cartId } },
    });
    for (const line of lines) {
      await this.itemRepo.deleteById(line.id);
    }
  }

  /**
   * Price a cart against the catalog as it stands now.
   *
   * A line whose product has been unpublished or deleted since it was added is
   * dropped from the result — silently, because the alternative is a storefront
   * that cannot render a cart at all once a product retires.
   */
  public async price(cartId: string): Promise<PricedCart> {
    const cart = await this.cartRepo.getById(cartId);
    const items = await this.itemRepo.findMany({
      where: { cartId: { eq: cartId } },
    });

    if (items.length === 0) {
      return { cart, lines: [], subtotal: 0, currency: "EUR" };
    }

    const found = await this.productRepo.findMany({
      where: { id: { inArray: [...new Set(items.map((i) => i.productId))] } },
    });
    const byId = new Map(found.map((p) => [p.id, p]));

    const lines: PricedCartLine[] = [];
    for (const item of items) {
      const product = byId.get(item.productId);
      if (!product?.published) {
        continue;
      }
      lines.push({
        item,
        productId: product.id,
        name: product.name,
        kind: product.kind,
        unitPrice: product.price,
        rateBps: product.vatRateBps,
        quantity: item.quantity,
        lineTotal: product.price * item.quantity,
        image: product.images[0],
      });
    }

    return {
      cart,
      lines,
      subtotal: lines.reduce((sum, l) => sum + l.lineTotal, 0),
      currency: lines[0] ? byId.get(lines[0].productId)!.currency : "EUR",
    };
  }

  /**
   * Fold an anonymous cart into the one belonging to a user who just signed in.
   */
  public async merge(fromCartId: string, toCartId: string): Promise<void> {
    const lines = await this.itemRepo.findMany({
      where: { cartId: { eq: fromCartId } },
    });
    for (const line of lines) {
      await this.add(toCartId, line.productId, line.quantity);
    }
    await this.cartRepo.deleteById(fromCartId);
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
