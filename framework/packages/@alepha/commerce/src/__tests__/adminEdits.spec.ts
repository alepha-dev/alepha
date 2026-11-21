import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import { AdminCategoryController } from "../admin/controllers/AdminCategoryController.ts";
import { AdminProductController } from "../admin/controllers/AdminProductController.ts";
import { AlephaCommerceAdmin } from "../admin/index.ts";
import { CartService } from "../cart/services/CartService.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { orderConfig } from "../orderConfigAtom.ts";
import { AdminPromotionController } from "../promotions/controllers/AdminPromotionController.ts";
import { AlephaCommercePromotions } from "../promotions/index.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { CategoryService } from "../services/CategoryService.ts";
import { OrderService } from "../services/OrderService.ts";
import { StockService } from "../services/StockService.ts";
import { VariantService } from "../services/VariantService.ts";

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmTestPostgres)
    .with(AlephaCommerceCheckout)
    .with(AlephaCommercePromotions)
    .with(AlephaCommerceAdmin);
  const ctx = {
    alepha,
    adminProducts: alepha.inject(AdminProductController),
    adminCategories: alepha.inject(AdminCategoryController),
    adminPromotions: alepha.inject(AdminPromotionController),
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    categories: alepha.inject(CategoryService),
    checkout: alepha.inject(CheckoutService),
    orders: alepha.inject(OrderService),
    payments: alepha.inject(PaymentService),
    stock: alepha.inject(StockService),
    variants: alepha.inject(VariantService),
  };
  await alepha.start();
  alepha.store.set(orderConfig.key, {
    ...alepha.store.get(orderConfig.key)!,
    currencies: ["EUR", "USD"],
  });
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const admin = { user: { id: randomUUID(), roles: ["admin"] } };

const aPiece = (ctx: Ctx, data: { vatRateBps?: number; categoryId?: string }) =>
  ctx.catalog.create({
    slug: `piece-${randomUUID()}`,
    name: "Piece",
    price: 8000,
    published: true,
    config: { trackStock: true },
    ...data,
  });

const buy = async (ctx: Ctx, productId: string) => {
  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  await ctx.carts.add(cart.id, productId, 1);
  const opened = await ctx.checkout.start(cart.id);
  const { session, handoff } = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://shop.example/thanks",
  });
  await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
  return session.orderId!;
};

describe("an emptied admin field", () => {
  it("clears a product's VAT rate and category", async ({ expect }) => {
    const ctx = await setup();
    const shelf = await ctx.categories.create({
      name: "Rings",
      slug: `rings-${randomUUID()}`,
    });
    const piece = await aPiece(ctx, { vatRateBps: 550, categoryId: shelf.id });

    const saved = await ctx.adminProducts.commerceAdminProductUpdate.fetch(
      {
        params: { id: piece.id },
        body: { vatRateBps: null, categoryId: null },
      },
      admin,
    );

    expect(saved.data.vatRateBps).toBeUndefined();
    expect(saved.data.categoryId).toBeUndefined();
    const read = await ctx.catalog.getById(piece.id);
    expect(read.vatRateBps).toBeUndefined();
    expect(read.categoryId).toBeUndefined();
  });

  it("clears a variant's own price, compare-at price, weight and image", async ({
    expect,
  }) => {
    const ctx = await setup();
    const piece = await aPiece(ctx, {});
    const variant = await ctx.variants.create(piece.id, {
      sku: `v-${randomUUID()}`,
      options: { Size: "52" },
      price: 9000,
      compareAtPrice: 12000,
      weightGrams: 40,
      image: "ring-52.jpg",
    });

    await ctx.adminProducts.commerceAdminProductVariantUpdate.fetch(
      {
        params: { id: piece.id, variantId: variant.id },
        body: {
          price: null,
          compareAtPrice: null,
          weightGrams: null,
          image: null,
        },
      },
      admin,
    );

    const read = await ctx.variants.getById(variant.id);
    expect(read.price).toBeUndefined();
    expect(read.compareAtPrice).toBeUndefined();
    expect(read.weightGrams).toBeUndefined();
    expect(read.image).toBeUndefined();
  });

  it("moves a category back to the top level", async ({ expect }) => {
    const ctx = await setup();
    const parent = await ctx.categories.create({
      name: "Jewellery",
      slug: `jewellery-${randomUUID()}`,
    });
    const child = await ctx.categories.create({
      name: "Rings",
      slug: `rings-${randomUUID()}`,
      parentId: parent.id,
      description: "Every ring.",
    });

    await ctx.adminCategories.commerceAdminCategoryUpdate.fetch(
      {
        params: { id: child.id },
        body: { parentId: null, description: null },
      },
      admin,
    );

    const read = await ctx.categories.getById(child.id);
    expect(read.parentId).toBeUndefined();
    expect(read.description).toBeUndefined();
  });

  it("turns a promotion's code, limits and window off", async ({ expect }) => {
    const ctx = await setup();
    const created = await ctx.adminPromotions.commerceAdminPromotionCreate(
      {
        body: {
          name: "Winter sale",
          code: `winter-${randomUUID().slice(0, 8)}`,
          kind: "amount",
          value: 500,
          minSubtotal: 5000,
          currency: "EUR",
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: "2026-02-01T00:00:00.000Z",
          usageLimit: 100,
          usagePerCustomer: 1,
        },
      },
      admin,
    );

    const saved = await ctx.adminPromotions.commerceAdminPromotionUpdate.fetch(
      {
        params: { id: created.id },
        body: {
          code: null,
          minSubtotal: null,
          currency: null,
          startsAt: null,
          endsAt: null,
          usageLimit: null,
          usagePerCustomer: null,
        },
      },
      admin,
    );

    expect(saved.data.code).toBeUndefined();
    expect(saved.data.minSubtotal).toBeUndefined();
    expect(saved.data.currency).toBeUndefined();
    expect(saved.data.startsAt).toBeUndefined();
    expect(saved.data.endsAt).toBeUndefined();
    expect(saved.data.usageLimit).toBeUndefined();
    expect(saved.data.usagePerCustomer).toBeUndefined();
  });
});

describe("a variant route under another product", () => {
  const twoProducts = async (ctx: Ctx) => {
    const mine = await aPiece(ctx, {});
    const theirs = await aPiece(ctx, {});
    const foreign = await ctx.variants.create(theirs.id, {
      sku: `v-${randomUUID()}`,
      options: { Size: "52" },
    });
    return { mine, foreign };
  };

  it("refuses to update it", async ({ expect }) => {
    const ctx = await setup();
    const { mine, foreign } = await twoProducts(ctx);

    await expect(
      ctx.adminProducts.commerceAdminProductVariantUpdate.fetch(
        {
          params: { id: mine.id, variantId: foreign.id },
          body: { active: false },
        },
        admin,
      ),
    ).rejects.toThrow(/No such variant/);
    expect((await ctx.variants.getById(foreign.id)).active).toBe(true);
  });

  it("refuses to delete it", async ({ expect }) => {
    const ctx = await setup();
    const { mine, foreign } = await twoProducts(ctx);

    await expect(
      ctx.adminProducts.commerceAdminProductVariantDelete.fetch(
        { params: { id: mine.id, variantId: foreign.id } },
        admin,
      ),
    ).rejects.toThrow(/No such variant/);
    expect((await ctx.variants.getById(foreign.id)).id).toBe(foreign.id);
  });

  it("refuses a price for it", async ({ expect }) => {
    const ctx = await setup();
    const { mine, foreign } = await twoProducts(ctx);

    await expect(
      ctx.adminProducts.commerceAdminProductPriceSet.fetch(
        {
          params: { id: mine.id },
          body: { currency: "USD", price: 9000, variantId: foreign.id },
        },
        admin,
      ),
    ).rejects.toThrow(/No such variant/);
  });
});

describe("a stock correction of zero", () => {
  it("is refused whatever its reason", async ({ expect }) => {
    const ctx = await setup();
    const piece = await aPiece(ctx, {});

    for (const reason of ["intake", "return", "adjustment"] as const) {
      await expect(
        ctx.adminProducts.commerceAdminProductAdjustStock.fetch(
          { params: { id: piece.id }, body: { quantity: 0, reason } },
          admin,
        ),
      ).rejects.toThrow(/cannot be zero/);
    }
    const movements = await ctx.stock.movementsOf(piece.id);
    expect(movements.content).toHaveLength(0);
  });
});

describe("shipping a partly refunded order", () => {
  it("ships one that has not left yet", async ({ expect }) => {
    const ctx = await setup();
    const piece = await aPiece(ctx, {});
    await ctx.stock.recordIntake(piece.id, 2);
    const orderId = await buy(ctx, piece.id);
    await ctx.orders.refund(orderId, { refundedTotal: 100 });

    const shipped = await ctx.orders.markShipped(orderId);

    expect(shipped.status).toBe("shipped");
  });

  it("refuses to ship one that already left", async ({ expect }) => {
    const ctx = await setup();
    const piece = await aPiece(ctx, {});
    await ctx.stock.recordIntake(piece.id, 2);
    const orderId = await buy(ctx, piece.id);
    const shipped = await ctx.orders.markShipped(orderId);
    await ctx.orders.refund(orderId, { refundedTotal: 100 });

    await expect(ctx.orders.markShipped(orderId)).rejects.toThrow(
      /Cannot move order/,
    );
    const read = await ctx.orders.getById(orderId);
    expect(read.status).toBe("partially_refunded");
    expect(read.shippedAt).toBe(shipped.shippedAt);
  });

  it("refuses to send a delivered one back to shipped", async ({ expect }) => {
    const ctx = await setup();
    const piece = await aPiece(ctx, {});
    await ctx.stock.recordIntake(piece.id, 2);
    const orderId = await buy(ctx, piece.id);
    await ctx.orders.markShipped(orderId);
    await ctx.orders.markDelivered(orderId);
    await ctx.orders.refund(orderId, { refundedTotal: 100 });

    await expect(ctx.orders.markShipped(orderId)).rejects.toThrow(
      /Cannot move order/,
    );
    expect((await ctx.orders.getById(orderId)).status).toBe(
      "partially_refunded",
    );
  });
});
