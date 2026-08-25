import { $inject, Alepha, z } from "alepha";
import { currentUserAtom } from "alepha/security";
import { $action } from "alepha/server";
import { $cookie } from "alepha/server/cookies";

import { CartService } from "../services/CartService.ts";

const cartLineSchema = z.object({
  productId: z.uuid(),
  name: z.text(),
  kind: z.text(),
  unitPrice: z.integer(),
  quantity: z.integer(),
  lineTotal: z.integer(),
  image: z.text().optional(),
});

const pricedCartSchema = z.object({
  cartId: z.uuid(),
  lines: z.array(cartLineSchema),
  subtotal: z.integer(),
  currency: z.text(),
});

/**
 * The cart as a storefront sees it.
 *
 * The cart handle lives in a signed, http-only cookie rather than being passed
 * by the client. A client-supplied cart id is an enumeration hole — anyone could
 * read or edit a stranger's basket by guessing a uuid. Signing it means the
 * server minted it.
 */
export class CartController {
  protected readonly url = "/commerce/cart";
  protected readonly group = "commerce:cart";
  protected readonly carts = $inject(CartService);
  protected readonly alepha = $inject(Alepha);

  protected readonly cartCookie = $cookie({
    name: "cart",
    ttl: [CartService.TTL_DAYS, "days"],
    httpOnly: true,
    sign: true,
    schema: z.text({ minLength: 16, maxLength: 128 }),
  });

  public readonly commerceCartGet = $action({
    method: "GET",
    path: this.url,
    group: this.group,
    description: "Read the current cart",
    schema: { response: pricedCartSchema },
    handler: async () => this.priced(),
  });

  public readonly commerceCartAdd = $action({
    method: "POST",
    path: `${this.url}/items`,
    group: this.group,
    description: "Add a product to the cart",
    schema: {
      body: z.object({
        productId: z.uuid(),
        quantity: z.integer().min(1).max(999).optional(),
      }),
      response: pricedCartSchema,
    },
    handler: async ({ body }) => {
      const cart = await this.resolveCart();
      await this.carts.add(cart.id, body.productId, body.quantity ?? 1);
      return this.priceOf(cart.id);
    },
  });

  public readonly commerceCartSetQuantity = $action({
    method: "PUT",
    path: `${this.url}/items/:productId`,
    group: this.group,
    description: "Set a line's quantity, or remove it at zero",
    schema: {
      params: z.object({ productId: z.uuid() }),
      body: z.object({ quantity: z.integer().min(0).max(999) }),
      response: pricedCartSchema,
    },
    handler: async ({ params, body }) => {
      const cart = await this.resolveCart();
      await this.carts.setQuantity(cart.id, params.productId, body.quantity);
      return this.priceOf(cart.id);
    },
  });

  public readonly commerceCartRemove = $action({
    method: "DELETE",
    path: `${this.url}/items/:productId`,
    group: this.group,
    description: "Remove a line from the cart",
    schema: {
      params: z.object({ productId: z.uuid() }),
      response: pricedCartSchema,
    },
    handler: async ({ params }) => {
      const cart = await this.resolveCart();
      await this.carts.remove(cart.id, params.productId);
      return this.priceOf(cart.id);
    },
  });

  /**
   * Read the cart the cookie points at, minting one if this visitor has none -
   * and, when the visitor is signed in, make sure it is THEIR cart.
   *
   * The ownership half is not decoration. A cart's `userId` is copied to the
   * checkout session and from there to the order, so a cart that never learned
   * who its owner was produced an order belonging to nobody: "my orders"
   * answered empty for every customer, and the address book, keyed on the same
   * id, was dead.
   *
   * The guest-cart merge happens here rather than on a sign-in event, because
   * this is the first moment BOTH facts are in hand - the cookie (a browser
   * fact) and the identity (a token fact). It runs on the first cart request
   * after signing in, is idempotent, and needs no hook into the auth flow.
   */
  public async resolveCart() {
    const userId = this.alepha.store.get(currentUserAtom)?.id;
    let token = this.cartCookie.get();

    if (!token) {
      // A returning customer whose cookie is gone still owns their cart.
      const owned = userId ? await this.carts.forUser(userId) : undefined;
      if (owned) {
        this.cartCookie.set(owned.token);
        return owned;
      }
      token = this.carts.newToken();
      this.cartCookie.set(token);
    }

    const cart = await this.carts.resolve(token, { userId });

    if (!userId) {
      return cart;
    }

    const owned = await this.carts.forUser(userId);

    // No account cart yet, or this IS it: claim it and we are done.
    if (!owned || owned.id === cart.id) {
      return cart.userId === userId ? cart : this.carts.claim(cart.id, userId);
    }

    // Two carts: the guest basket folds into the account one, and the cookie
    // follows. Dropping the guest lines instead would silently empty a basket
    // the customer filled before signing in.
    await this.carts.merge(cart.id, owned.id);
    this.cartCookie.set(owned.token);
    return owned;
  }

  protected async priced() {
    const cart = await this.resolveCart();
    return this.priceOf(cart.id);
  }

  protected async priceOf(cartId: string) {
    const priced = await this.carts.price(cartId);
    return {
      cartId,
      lines: priced.lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        kind: l.kind,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        lineTotal: l.lineTotal,
        image: l.image,
      })),
      subtotal: priced.subtotal,
      currency: priced.currency,
    };
  }
}
