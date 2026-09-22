import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

import { type ProductEntity, products } from "../../entities/products.ts";
import { CommerceError } from "../../errors/CommerceError.ts";
import { LineConfigService } from "../../services/LineConfigService.ts";
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
  /**
   * The line's id: what a storefront names to change or remove it, since two
   * lines of one product (two slots) cannot be told apart by the product.
   */
  lineId: string;
  productId: string;
  /**
   * What this line chooses beyond the product (the court and the interval),
   * as validated when it was added.
   */
  lineConfig?: Record<string, any>;
  name: string;
  kind: string;
  unitPrice: number;
  /**
   * The product's VAT rate in basis points, or unset for the seller default.
   */
  rateBps?: number;
  quantity: number;
  /**
   * `unitPrice * quantity`. The unit price comes from the kind's `unitPrice`
   * hook when it has one, else from the catalogue, and never from the client.
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
  protected readonly lines = $inject(LineConfigService);
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
   * @throws InvalidLineError when the handler refuses the line.
   */
  public async add(
    cartId: string,
    productId: string,
    quantity = 1,
    lineConfig?: unknown,
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

    const config = await this.lines.accept(product, lineConfig, quantity);
    const lineKey = this.lineKey(config);

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
      const lineConfig = await this.stillSellable(product, item);
      if (lineConfig === false) {
        continue;
      }
      const unitPrice = await this.lines.unitPrice(product, lineConfig);
      lines.push({
        item,
        lineId: item.id,
        productId: product.id,
        lineConfig,
        name: product.name,
        kind: product.kind,
        unitPrice,
        rateBps: product.vatRateBps,
        quantity: item.quantity,
        lineTotal: unitPrice * item.quantity,
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
   * The line key of a validated line config: `""` without one, else the
   * sha-256 of its canonical JSON (keys sorted at every depth), so the same
   * choice written in a different key order is the same line.
   */
  public lineKey(lineConfig: Record<string, any> | undefined): string {
    if (lineConfig === undefined) {
      return "";
    }
    return this.crypto.hash(JSON.stringify(this.canonical(lineConfig)));
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
   * The line's config if its kind still sells it, `false` when the kind now
   * refuses it. Only a refusal (a `CommerceError`) drops the line; any other
   * failure is a fault and propagates.
   */
  protected async stillSellable(
    product: ProductEntity,
    item: CartItemEntity,
  ): Promise<Record<string, any> | undefined | false> {
    try {
      return await this.lines.accept(product, item.lineConfig, item.quantity);
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
