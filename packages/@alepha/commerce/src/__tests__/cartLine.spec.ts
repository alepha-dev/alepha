import { randomUUID } from "node:crypto";

import { $inject, Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import type { ProductEntity } from "../entities/products.ts";
import { InvalidLineError } from "../errors/CommerceError.ts";
import { ProductKindHandler } from "../interfaces/ProductKindHandler.ts";
import { ProductKindRegistry } from "../providers/ProductKindRegistry.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";

/**
 * A kind whose lines differ: which court, and when. It holds nothing (that is
 * `ResourceKindHandler`'s job); it only exercises the line config's path
 * through the cart and the order.
 */
class TestSlotKind extends ProductKindHandler {
  public readonly kind = "test-slot";
  public readonly configSchema = z.object({ courts: z.array(z.text()) });
  public readonly lineSchema = z.object({
    court: z.text(),
    startsAt: z.text(),
  });

  protected readonly dateTime = $inject(DateTimeProvider);

  public async validateLine(
    product: ProductEntity,
    line: Record<string, any>,
    quantity: number,
  ): Promise<void> {
    if (!(product.config as { courts: string[] }).courts.includes(line.court)) {
      throw new InvalidLineError(`Court ${line.court} is not sold here.`);
    }
    if (line.startsAt < this.dateTime.nowISOString()) {
      throw new InvalidLineError(`The slot at ${line.startsAt} has passed.`);
    }
    if (quantity > 2) {
      throw new InvalidLineError("Two players per slot at most.");
    }
  }

  /**
   * Evenings cost half as much again: a price that depends on the line.
   */
  public async unitPrice(
    product: ProductEntity,
    line: Record<string, any> | undefined,
  ): Promise<number> {
    const hour = Number(String(line?.startsAt).slice(11, 13));
    return hour >= 18 ? product.price * 1.5 : product.price;
  }

  public async fulfil(): Promise<void> {}
}

const setup = async () => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:" },
  }).with(AlephaCommerceCheckout);
  alepha.inject(ProductKindRegistry).add(alepha.inject(TestSlotKind));
  const ctx = {
    alepha,
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    checkout: alepha.inject(CheckoutService),
    orders: alepha.inject(OrderService),
    dateTime: alepha.inject(DateTimeProvider),
  };
  await alepha.start();
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const padel = (ctx: Ctx) =>
  ctx.catalog.create({
    kind: "test-slot",
    slug: `padel-${randomUUID()}`,
    name: "Padel, 90 minutes",
    price: 2000,
    published: true,
    config: { courts: ["court-1", "court-2"] },
  });

const aRing = (ctx: Ctx) =>
  ctx.catalog.create({
    slug: `ring-${randomUUID()}`,
    name: "Bague Aurore",
    price: 8900,
    published: true,
    config: { trackStock: false },
  });

const saturday = (hhmm: string) => `2030-01-05T${hhmm}:00.000Z`;

const aCart = async (ctx: Ctx) => ctx.carts.resolve(ctx.carts.newToken());

describe("cart line", () => {
  it("holds two slots of one product as two lines", async ({ expect }) => {
    const ctx = await setup();
    const product = await padel(ctx);
    const cart = await aCart(ctx);

    await ctx.carts.add(cart.id, product.id, 1, {
      court: "court-1",
      startsAt: saturday("10:00"),
    });
    await ctx.carts.add(cart.id, product.id, 1, {
      court: "court-2",
      startsAt: saturday("10:00"),
    });

    const priced = await ctx.carts.price(cart.id);
    expect(priced.lines.map((it) => it.lineConfig?.court)).toEqual([
      "court-1",
      "court-2",
    ]);
    expect(new Set(priced.lines.map((it) => it.lineId)).size).toBe(2);
  });

  it("merges the same slot, whatever order its keys arrive in", async ({
    expect,
  }) => {
    const ctx = await setup();
    const product = await padel(ctx);
    const cart = await aCart(ctx);

    await ctx.carts.add(cart.id, product.id, 1, {
      court: "court-1",
      startsAt: saturday("10:00"),
    });
    await ctx.carts.add(cart.id, product.id, 1, {
      startsAt: saturday("10:00"),
      court: "court-1",
    });

    const priced = await ctx.carts.price(cart.id);
    expect(priced.lines.map((it) => it.quantity)).toEqual([2]);

    // A third add takes the merged line past what the kind allows.
    await expect(
      ctx.carts.add(cart.id, product.id, 1, {
        court: "court-1",
        startsAt: saturday("10:00"),
      }),
    ).rejects.toThrow(/Two players/);
    expect((await ctx.carts.price(cart.id)).lines[0]?.quantity).toBe(2);
  });

  it("still merges two adds of a good into one line", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx);
    const cart = await aCart(ctx);

    await ctx.carts.add(cart.id, ring.id, 1);
    await ctx.carts.add(cart.id, ring.id, 2);

    const priced = await ctx.carts.price(cart.id);
    expect(priced.lines.map((it) => [it.quantity, it.item.lineKey])).toEqual([
      [3, ""],
    ]);
  });

  it("writes nothing for a line config its kind refuses", async ({
    expect,
  }) => {
    const ctx = await setup();
    const product = await padel(ctx);
    const ring = await aRing(ctx);
    const cart = await aCart(ctx);

    // A buyer's line cannot override the product's config.
    await expect(
      ctx.carts.add(cart.id, ring.id, 1, { trackStock: false }),
    ).rejects.toThrow(/takes no line config/);
    // Malformed, missing, and a court this product does not sell.
    await expect(
      ctx.carts.add(cart.id, product.id, 1, { court: 3 }),
    ).rejects.toThrow(InvalidLineError);
    await expect(ctx.carts.add(cart.id, product.id, 1)).rejects.toThrow(
      InvalidLineError,
    );
    await expect(
      ctx.carts.add(cart.id, product.id, 1, {
        court: "court-9",
        startsAt: saturday("10:00"),
      }),
    ).rejects.toThrow(/not sold here/);

    expect((await ctx.carts.price(cart.id)).lines).toEqual([]);
  });

  it("changes and removes a line by its id, in its own cart only", async ({
    expect,
  }) => {
    const ctx = await setup();
    const product = await padel(ctx);
    const [mine, theirs] = [await aCart(ctx), await aCart(ctx)];
    const slot = (court: string) => ({ court, startsAt: saturday("10:00") });

    const first = await ctx.carts.add(mine.id, product.id, 1, slot("court-1"));
    const second = await ctx.carts.add(mine.id, product.id, 1, slot("court-2"));

    await ctx.carts.setQuantity(mine.id, first.id, 2);
    await ctx.carts.remove(mine.id, second.id);
    // Someone else's cart cannot touch the line.
    await ctx.carts.remove(theirs.id, first.id);

    const priced = await ctx.carts.price(mine.id);
    expect(priced.lines.map((it) => [it.lineId, it.quantity])).toEqual([
      [first.id, 2],
    ]);

    // And the kind still judges the quantity.
    await expect(ctx.carts.setQuantity(mine.id, first.id, 3)).rejects.toThrow(
      /Two players/,
    );
  });

  it("prices a line through the kind, in the cart and in the order alike", async ({
    expect,
  }) => {
    const ctx = await setup();
    const product = await padel(ctx);
    const cart = await aCart(ctx);
    await ctx.carts.add(cart.id, product.id, 1, {
      court: "court-1",
      startsAt: saturday("10:00"),
    });
    await ctx.carts.add(cart.id, product.id, 2, {
      court: "court-1",
      startsAt: saturday("19:00"),
    });

    const priced = await ctx.carts.price(cart.id);
    expect(priced.lines.map((it) => it.unitPrice)).toEqual([2000, 3000]);
    expect(priced.subtotal).toBe(2000 + 2 * 3000);

    const opened = await ctx.checkout.start(cart.id);
    const { session } = await ctx.checkout.pay(opened.id, {
      returnUrl: "https://club.example/merci",
    });
    const order = await ctx.orders.getById(session.orderId!);
    const items = await ctx.orders.itemsOf(order.id);

    expect(order.total).toBe(8000);
    expect(
      items
        .map((it) => [it.unitPrice, it.lineConfig?.startsAt, it.config])
        .sort((a, b) => Number(a[0]) - Number(b[0])),
    ).toEqual([
      [2000, saturday("10:00"), { courts: ["court-1", "court-2"] }],
      [3000, saturday("19:00"), { courts: ["court-1", "court-2"] }],
    ]);
  });

  it("judges the line again when the order is created", async ({ expect }) => {
    const ctx = await setup();
    const product = await padel(ctx);

    await expect(
      ctx.orders.create({
        lines: [
          {
            productId: product.id,
            quantity: 1,
            lineConfig: { court: "court-9", startsAt: saturday("10:00") },
          },
        ],
      }),
    ).rejects.toThrow(/not sold here/);
    await expect(
      ctx.orders.create({
        lines: [
          {
            productId: (await aRing(ctx)).id,
            quantity: 1,
            lineConfig: { trackStock: false },
          },
        ],
      }),
    ).rejects.toThrow(/takes no line config/);
  });

  it("drops a line whose slot has passed, as it drops an unpublished product", async ({
    expect,
  }) => {
    const ctx = await setup();
    const product = await padel(ctx);
    const ring = await aRing(ctx);
    const cart = await aCart(ctx);
    const soon = new Date(ctx.dateTime.nowMillis() + 3_600_000).toISOString();

    await ctx.carts.add(cart.id, product.id, 1, {
      court: "court-1",
      startsAt: soon,
    });
    await ctx.carts.add(cart.id, ring.id, 1);
    expect((await ctx.carts.price(cart.id)).lines).toHaveLength(2);

    await ctx.dateTime.travel(2, "hours");

    expect(
      (await ctx.carts.price(cart.id)).lines.map((it) => it.productId),
    ).toEqual([ring.id]);
  });

  it("carries the line config through a merge, and leaves a dead line behind", async ({
    expect,
  }) => {
    const ctx = await setup();
    const product = await padel(ctx);
    const [guest, account] = [await aCart(ctx), await aCart(ctx)];
    const soon = new Date(ctx.dateTime.nowMillis() + 3_600_000).toISOString();

    await ctx.carts.add(guest.id, product.id, 1, {
      court: "court-2",
      startsAt: saturday("10:00"),
    });
    await ctx.carts.add(guest.id, product.id, 1, {
      court: "court-1",
      startsAt: soon,
    });
    await ctx.dateTime.travel(2, "hours");

    await ctx.carts.merge(guest.id, account.id);

    const priced = await ctx.carts.price(account.id);
    expect(priced.lines.map((it) => it.lineConfig)).toEqual([
      { court: "court-2", startsAt: saturday("10:00") },
    ]);
  });
});
