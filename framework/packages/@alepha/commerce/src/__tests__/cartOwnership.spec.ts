import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { currentUserAtom } from "alepha/security";
import type { Cookies } from "alepha/server/cookies";
import { describe, expect, it } from "vitest";

import { CartController } from "../cart/controllers/CartController.ts";
import { CartService } from "../cart/services/CartService.ts";
import { CheckoutController } from "../checkout/controllers/CheckoutController.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { StockService } from "../services/StockService.ts";

/**
 * A cart's `userId` is copied to the checkout session and from there to the
 * order. Neither controller ever wrote it, so every order belonged to nobody:
 * "my orders" answered empty for every customer, `CartService.merge` could
 * never run, and the address book - keyed on the same id - was dead.
 */
describe("cart ownership", () => {
  const setup = async () => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaCommerceCheckout);
    const ctx = {
      alepha,
      cartController: alepha.inject(CartController),
      checkoutController: alepha.inject(CheckoutController),
      carts: alepha.inject(CartService),
      checkout: alepha.inject(CheckoutService),
      catalog: alepha.inject(CatalogService),
      orders: alepha.inject(OrderService),
      stock: alepha.inject(StockService),
      payments: alepha.inject(PaymentService),
    };
    await alepha.start();
    return ctx;
  };

  type Ctx = Awaited<ReturnType<typeof setup>>;

  /**
   * One browser: its own cookie jar, carried between calls the way a browser
   * carries it - what the response SET becomes what the next request SENDS.
   * Without that the cart handle is lost after every call and each request
   * mints a new cart.
   */
  const browser = (ctx: Ctx) => {
    const jar: Cookies = { req: {}, res: {} };
    const request: any = { headers: {}, reply: { headers: {} }, cookies: jar };

    return async <R>(
      userId: string | undefined,
      fn: () => R | Promise<R>,
    ): Promise<R> => {
      const result = await ctx.alepha.context.run(async () => {
        ctx.alepha.set("alepha.http.request", request);
        ctx.alepha.store.set(
          currentUserAtom,
          userId ? ({ id: userId, roles: [] } as any) : undefined,
        );
        return await fn();
      });

      for (const [name, cookie] of Object.entries(jar.res)) {
        if (cookie) jar.req[name] = cookie.value;
      }
      jar.res = {};

      return result;
    };
  };

  const aRing = (catalog: CatalogService) =>
    catalog.create({
      slug: `ring-${randomUUID()}`,
      name: "Bague Aurore",
      price: 8900,
      published: true,
      config: { trackStock: true },
    });

  it("claims an anonymous cart for the customer who signs in", async () => {
    const ctx = await setup();
    const visit = browser(ctx);

    const guest = await visit(undefined, () =>
      ctx.cartController.resolveCart(),
    );
    expect(guest.userId).toBeUndefined();

    const userId = randomUUID();
    const claimed = await visit(userId, () => ctx.cartController.resolveCart());

    // The SAME cart, now owned - not a second one.
    expect(claimed.id).toBe(guest.id);
    expect(claimed.userId).toBe(userId);
  });

  it("puts a signed-in customer's order under their own orders", async () => {
    const ctx = await setup();
    const visit = browser(ctx);
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 5);

    const userId = randomUUID();
    const cart = await visit(userId, () => ctx.cartController.resolveCart());
    await ctx.carts.add(cart.id, ring.id, 1);

    expect(cart.userId).toBe(userId);

    const session = await visit(userId, () =>
      ctx.checkoutController.commerceCheckoutStart.run({ body: {} } as never),
    );
    // Read back from the store, not from the response: `sessionSchema` does
    // not expose `userId` to the storefront, and a response schema is what
    // serializes.
    expect((await ctx.checkout.getById(session.id)).userId).toBe(userId);

    const { handoff } = await ctx.checkout.pay(session.id, {
      returnUrl: "https://bijoux.example/merci",
    });
    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

    const page = await ctx.orders.listForUser(userId, {});
    expect(page.content).toHaveLength(1);
    expect(page.content[0].status).toBe("paid");
  });

  it("folds a guest basket into the account cart at sign-in", async () => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 5);
    const userId = randomUUID();

    // The customer already owns a cart, from an earlier signed-in visit.
    const account = await ctx.carts.resolve(ctx.carts.newToken(), { userId });
    await ctx.carts.add(account.id, ring.id, 1);

    // On this browser they fill a basket while signed out...
    const visit = browser(ctx);
    const guest = await visit(undefined, () =>
      ctx.cartController.resolveCart(),
    );
    await ctx.carts.add(guest.id, ring.id, 2);

    // ...then sign in.
    const merged = await visit(userId, () => ctx.cartController.resolveCart());

    expect(merged.id).toBe(account.id);
    const priced = await ctx.carts.price(merged.id);
    // Three units: the guest lines were folded in, not dropped and not left
    // stranded on a cart nobody will look at again.
    expect(priced.lines).toHaveLength(1);
    expect(priced.lines[0].quantity).toBe(3);
  });
});
