import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { AlephaCommerceCart } from "../cart/index.ts";
import { CartService } from "../cart/services/CartService.ts";
import { ProductController } from "../controllers/ProductController.ts";
import { stockReservations } from "../entities/stockReservations.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { StockService } from "../services/StockService.ts";
import { VariantService } from "../services/VariantService.ts";

/**
 * Reaches the holds directly, to age one past its expiry.
 */
class Ledger {
  public readonly holds = $repository(stockReservations);
}

const setup = async (backend: "postgres" | "sqlite" = "postgres") => {
  const alepha =
    backend === "postgres"
      ? Alepha.create().with(AlephaOrmPostgres).with(AlephaCommerceCart)
      : Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }).with(
          AlephaCommerceCart,
        );
  const ctx = {
    alepha,
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    ledger: alepha.inject(Ledger),
    productApi: alepha.inject(ProductController),
    stock: alepha.inject(StockService),
    variants: alepha.inject(VariantService),
  };
  await alepha.start();
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const aPiece = async (ctx: Ctx, stock: number) => {
  const piece = await ctx.catalog.create({
    slug: `piece-${randomUUID()}`,
    name: "Bague",
    price: 1000,
    published: true,
    config: { trackStock: true },
  });
  await ctx.stock.recordIntake(piece.id, stock);
  return piece;
};

/**
 * Count the reads a call makes, and what each table was asked for.
 */
const reads = async (ctx: Ctx, fn: () => Promise<unknown>) => {
  const tables: string[] = [];
  const off = ctx.alepha.events.on("repository:read:before", (event) => {
    tables.push(event.tableName);
  });
  await fn();
  off();
  return tables;
};

describe("stock figures", () => {
  describe.each(["postgres", "sqlite"] as const)("on %s", (backend) => {
    it("sums the ledger and the live holds in the database", async ({
      expect,
    }) => {
      const ctx = await setup(backend);
      const piece = await aPiece(ctx, 5);
      await ctx.stock.recordSale(piece.id, 2);
      await ctx.stock.reserve(piece.id, 1, { orderId: randomUUID() });

      expect(await ctx.stock.onHand(piece.id)).toBe(3);
      expect(await ctx.stock.reserved(piece.id)).toBe(1);
      expect(await ctx.stock.available(piece.id)).toBe(2);
    });

    it("answers zero for a product with no ledger", async ({ expect }) => {
      const ctx = await setup(backend);

      expect(await ctx.stock.onHand(randomUUID())).toBe(0);
      expect(await ctx.stock.reserved(randomUUID())).toBe(0);
    });

    it("gives a whole page its figures at once", async ({ expect }) => {
      const ctx = await setup(backend);
      const a = await aPiece(ctx, 5);
      const b = await aPiece(ctx, 2);
      await ctx.stock.reserve(a.id, 1, { orderId: randomUUID() });

      const figures = await ctx.stock.figuresFor([a.id, b.id, randomUUID()]);

      expect(figures.of(a.id)).toEqual({
        onHand: 5,
        reserved: 1,
        available: 4,
      });
      expect(figures.of(b.id).available).toBe(2);
      expect(figures.of(randomUUID()).available).toBe(0);
    });

    it("tells the variants of a product apart on a page", async ({
      expect,
    }) => {
      const ctx = await setup(backend);
      const piece = await aPiece(ctx, 0);
      const small = await ctx.variants.create(piece.id, {
        sku: `S-${randomUUID()}`,
        options: { Taille: "S" },
      });
      const large = await ctx.variants.create(piece.id, {
        sku: `L-${randomUUID()}`,
        options: { Taille: "L" },
      });
      await ctx.stock.recordIntake(piece.id, 2, { variantId: small.id });
      await ctx.stock.recordIntake(piece.id, 3, { variantId: large.id });

      const figures = await ctx.stock.figuresFor([piece.id]);

      expect(figures.of(piece.id, small.id).onHand).toBe(2);
      expect(figures.of(piece.id, large.id).onHand).toBe(3);
      expect(figures.of(piece.id).onHand).toBe(5);
    });
  });
});

describe("the catalogue list", () => {
  it("costs the same reads for a page of twenty as for a page of two", async ({
    expect,
  }) => {
    const ctx = await setup();
    for (let i = 0; i < 20; i++) {
      await aPiece(ctx, 1);
    }

    const small = await reads(ctx, () =>
      ctx.productApi.commerceProductList.run({ query: { size: 2 } }),
    );
    const large = await reads(ctx, () =>
      ctx.productApi.commerceProductList.run({ query: { size: 20 } }),
    );

    expect(large).toEqual(small);
    expect(
      large.filter((it) => it === "commerce_stock_movements"),
    ).toHaveLength(1);
    expect(
      large.filter((it) => it === "commerce_stock_reservations"),
    ).toHaveLength(1);
  });
});

describe("bulk writes", () => {
  describe.each(["postgres", "sqlite"] as const)("on %s", (backend) => {
    it("releases every expired hold, and says how many", async ({ expect }) => {
      const ctx = await setup(backend);
      const piece = await aPiece(ctx, 5);
      for (let i = 0; i < 2; i++) {
        const hold = await ctx.stock.reserve(piece.id, 1, {
          orderId: randomUUID(),
        });
        await ctx.ledger.holds.updateById(hold.id, {
          expiresAt: "2020-01-01T00:00:00.000Z",
        });
      }
      await ctx.stock.reserve(piece.id, 1, { orderId: randomUUID() });

      expect(await ctx.stock.releaseExpiredReservations()).toBe(2);
      expect(await ctx.stock.reserved(piece.id)).toBe(1);
    });

    it("releases an order's holds", async ({ expect }) => {
      const ctx = await setup(backend);
      const piece = await aPiece(ctx, 5);
      const orderId = randomUUID();
      await ctx.stock.reserve(piece.id, 1, { orderId });
      await ctx.stock.reserve(piece.id, 2, { orderId });

      await ctx.stock.releaseFor(orderId);

      expect(await ctx.stock.reserved(piece.id)).toBe(0);
    });

    it("clears a cart's lines", async ({ expect }) => {
      const ctx = await setup(backend);
      const a = await aPiece(ctx, 5);
      const b = await aPiece(ctx, 5);
      const cart = await ctx.carts.resolve(ctx.carts.newToken());
      await ctx.carts.add(cart.id, a.id, 1);
      await ctx.carts.add(cart.id, b.id, 1);

      await ctx.carts.clear(cart.id);

      expect((await ctx.carts.price(cart.id)).lines).toHaveLength(0);
    });
  });
});
