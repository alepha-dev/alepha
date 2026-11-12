import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { $repository, AlephaOrmTestPostgres } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import { describe, it } from "vitest";

import { cartItems } from "../cart/entities/cartItems.ts";
import { carts } from "../cart/entities/carts.ts";
import { CartService } from "../cart/services/CartService.ts";
import { checkoutSessions } from "../checkout/entities/checkoutSessions.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { CheckoutSweeper } from "../checkout/services/CheckoutSweeper.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { StockService } from "../services/StockService.ts";

const LONG_AGO = "2020-01-01T00:00:00.000Z";

class Ledger {
  public readonly carts = $repository(carts);
  public readonly items = $repository(cartItems);
  public readonly sessions = $repository(checkoutSessions);
}

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmTestPostgres)
    .with(AlephaCommerceCheckout);
  const ctx = {
    alepha,
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    checkout: alepha.inject(CheckoutService),
    ledger: alepha.inject(Ledger),
    stock: alepha.inject(StockService),
    sweeper: alepha.inject(CheckoutSweeper),
  };
  await alepha.start();
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const aFilledCart = async (ctx: Ctx) => {
  const ring = await ctx.catalog.create({
    slug: `ring-${randomUUID()}`,
    name: "Bague Aurore",
    price: 8900,
    published: true,
    config: { trackStock: true },
  });
  await ctx.stock.recordIntake(ring.id, 5);
  const token = ctx.carts.newToken();
  const cart = await ctx.carts.resolve(token);
  await ctx.carts.add(cart.id, ring.id, 1);
  return { cart, token, ring };
};

describe("the sweep", () => {
  it("deletes an expired cart and its lines, and nothing else", async ({
    expect,
  }) => {
    const ctx = await setup();
    const expired = await aFilledCart(ctx);
    const live = await aFilledCart(ctx);
    await ctx.ledger.carts.updateById(expired.cart.id, { expiresAt: LONG_AGO });

    await ctx.sweeper.sweep();

    expect(await ctx.ledger.carts.findById(expired.cart.id)).toBeUndefined();
    expect(
      await ctx.ledger.items.count({ cartId: { eq: expired.cart.id } }),
    ).toBe(0);
    expect(await ctx.ledger.carts.findById(live.cart.id)).toBeDefined();
    expect(await ctx.ledger.items.count({ cartId: { eq: live.cart.id } })).toBe(
      1,
    );
  });

  it("keeps an expired cart a payment is still running on", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { cart } = await aFilledCart(ctx);
    const session = await ctx.checkout.start(cart.id);
    await ctx.checkout.pay(session.id, {
      returnUrl: "https://bijoux.example/merci",
    });
    await ctx.ledger.carts.updateById(cart.id, { expiresAt: LONG_AGO });

    await ctx.sweeper.sweep();

    expect(await ctx.ledger.carts.findById(cart.id)).toBeDefined();
  });

  it("marks a stale open checkout abandoned, and leaves a recent one", async ({
    expect,
  }) => {
    const ctx = await setup();
    const stale = await ctx.checkout.start((await aFilledCart(ctx)).cart.id);
    const fresh = await ctx.checkout.start((await aFilledCart(ctx)).cart.id);
    await ctx.ledger.sessions.updateById(
      stale.id,
      {},
      { now: "2020-01-01T00:00:00.000Z" },
    );

    await ctx.sweeper.sweep();

    expect((await ctx.checkout.getById(stale.id)).status).toBe("abandoned");
    expect((await ctx.checkout.getById(fresh.id)).status).toBe("open");
  });

  it("runs on a cron of its own", async ({ expect }) => {
    const ctx = await setup();

    const job = ctx.alepha
      .inject(CronProvider)
      .getCronJobs()
      .find((it) => it.name === "system.commerce.sweep-checkouts");

    expect(job?.expression).toBe("0 3 * * *");
  });
});

describe("CartService.resolve", () => {
  it("starts a new cart for an expired token", async ({ expect }) => {
    const ctx = await setup();
    const { cart, token } = await aFilledCart(ctx);
    await ctx.ledger.carts.updateById(cart.id, { expiresAt: LONG_AGO });

    const next = await ctx.carts.resolve(token);

    expect(next.id).not.toBe(cart.id);
    expect(next.token).toBe(token);
    expect((await ctx.carts.price(next.id)).lines).toHaveLength(0);
  });

  it("keeps a live cart", async ({ expect }) => {
    const ctx = await setup();
    const { cart, token } = await aFilledCart(ctx);

    expect((await ctx.carts.resolve(token)).id).toBe(cart.id);
  });
});

describe("CartService.forUser", () => {
  it("does not hand back an expired cart", async ({ expect }) => {
    const ctx = await setup();
    const userId = randomUUID();
    const { cart } = await aFilledCart(ctx);
    await ctx.carts.claim(cart.id, userId);
    await ctx.ledger.carts.updateById(cart.id, { expiresAt: LONG_AGO });

    expect(await ctx.carts.forUser(userId)).toBeUndefined();
  });
});
