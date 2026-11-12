import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import { AdminProductController } from "../admin/controllers/AdminProductController.ts";
import { AlephaCommerceAdmin } from "../admin/index.ts";
import { CartService } from "../cart/services/CartService.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { ProductController } from "../controllers/ProductController.ts";
import { orderConfig } from "../orderConfigAtom.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { PriceListService } from "../services/PriceListService.ts";
import { StockService } from "../services/StockService.ts";
import { VariantService } from "../services/VariantService.ts";
import { AdminShippingController } from "../shipping/controllers/AdminShippingController.ts";
import { AlephaCommerceShipping } from "../shipping/index.ts";
import { ShippingService } from "../shipping/services/ShippingService.ts";

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmTestPostgres)
    .with(AlephaCommerceShipping)
    .with(AlephaCommerceAdmin);
  const ctx = {
    alepha,
    adminProducts: alepha.inject(AdminProductController),
    adminShipping: alepha.inject(AdminShippingController),
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    checkout: alepha.inject(CheckoutService),
    prices: alepha.inject(PriceListService),
    productApi: alepha.inject(ProductController),
    shipping: alepha.inject(ShippingService),
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

const aPiece = async (
  ctx: Ctx,
  data: Partial<Parameters<CatalogService["create"]>[0]> = {},
) => {
  const piece = await ctx.catalog.create({
    slug: `piece-${randomUUID()}`,
    name: "Piece",
    price: 8000,
    published: true,
    config: { trackStock: true },
    ...data,
  });
  await ctx.stock.recordIntake(piece.id, 50);
  return piece;
};

const read = (ctx: Ctx, slug: string, currency?: string) =>
  ctx.productApi.commerceProductGetBySlug.run({
    params: { slug },
    query: currency ? { currency } : {},
  });

describe("a compare-at price", () => {
  it("reaches the storefront above the price", async ({ expect }) => {
    const ctx = await setup();
    const piece = await aPiece(ctx, { compareAtPrice: 10000 });

    expect((await read(ctx, piece.slug)).compareAtPrice).toBe(10000);
  });

  it("is dropped at or below the price", async ({ expect }) => {
    const ctx = await setup();
    const piece = await aPiece(ctx, { compareAtPrice: 8000 });

    expect((await read(ctx, piece.slug)).compareAtPrice).toBeUndefined();
  });

  it("is in the listing too", async ({ expect }) => {
    const ctx = await setup();
    const piece = await aPiece(ctx, { compareAtPrice: 10000 });

    const page = await ctx.productApi.commerceProductList.run({ query: {} });

    expect(page.content.find((it) => it.id === piece.id)?.compareAtPrice).toBe(
      10000,
    );
  });

  it("is dropped in another currency, where it means nothing", async ({
    expect,
  }) => {
    const ctx = await setup();
    const piece = await aPiece(ctx, { compareAtPrice: 10000 });
    await ctx.prices.set(piece, { currency: "USD", price: 9000 });

    expect((await read(ctx, piece.slug, "USD")).compareAtPrice).toBeUndefined();
  });

  it("takes the variant's own first", async ({ expect }) => {
    const ctx = await setup();
    const piece = await aPiece(ctx, { compareAtPrice: 10000 });
    await ctx.variants.create(piece.id, {
      sku: `own-${randomUUID()}`,
      options: { Taille: "52" },
      compareAtPrice: 12000,
    });
    await ctx.variants.create(piece.id, {
      sku: `product-${randomUUID()}`,
      options: { Taille: "54" },
    });

    const { variants } = await read(ctx, piece.slug);

    expect(variants?.map((it) => it.compareAtPrice)).toEqual([12000, 10000]);
  });

  it("can be taken off when the sale ends", async ({ expect }) => {
    const ctx = await setup();
    const piece = await aPiece(ctx, { compareAtPrice: 10000 });

    await ctx.adminProducts.commerceAdminProductUpdate.fetch(
      { params: { id: piece.id }, body: { compareAtPrice: null } },
      admin,
    );

    expect((await read(ctx, piece.slug)).compareAtPrice).toBeUndefined();
  });
});

describe("search metadata", () => {
  it("reaches the storefront", async ({ expect }) => {
    const ctx = await setup();
    const piece = await aPiece(ctx, {
      metaTitle: "A pearl necklace",
      metaDescription: "Hand-cut mother of pearl.",
    });

    const product = await read(ctx, piece.slug);

    expect(product.metaTitle).toBe("A pearl necklace");
    expect(product.metaDescription).toBe("Hand-cut mother of pearl.");
  });

  it("is written from the back office", async ({ expect }) => {
    const ctx = await setup();
    const piece = await aPiece(ctx);

    await ctx.adminProducts.commerceAdminProductUpdate.fetch(
      {
        params: { id: piece.id },
        body: { metaTitle: "Title", metaDescription: "Description" },
      },
      admin,
    );

    expect((await read(ctx, piece.slug)).metaTitle).toBe("Title");
  });
});

describe("weight and dimensions", () => {
  it("reach the storefront", async ({ expect }) => {
    const ctx = await setup();
    const piece = await aPiece(ctx, {
      weightGrams: 420,
      lengthMm: 180,
      widthMm: 110,
      heightMm: 30,
    });

    const product = await read(ctx, piece.slug);

    expect(product).toMatchObject({
      weightGrams: 420,
      lengthMm: 180,
      widthMm: 110,
      heightMm: 30,
    });
  });

  it("add up on a cart, the variant's over the product's", async ({
    expect,
  }) => {
    const ctx = await setup();
    const plain = await aPiece(ctx, { weightGrams: 300 });
    const sized = await aPiece(ctx, { weightGrams: 300 });
    const heavy = await ctx.variants.create(sized.id, {
      sku: `heavy-${randomUUID()}`,
      options: { Taille: "60" },
      weightGrams: 500,
    });
    await ctx.stock.recordIntake(sized.id, 5, { variantId: heavy.id });
    const weightless = await aPiece(ctx);
    const cart = await ctx.carts.resolve(ctx.carts.newToken());

    await ctx.carts.add(cart.id, plain.id, 2);
    await ctx.carts.add(cart.id, sized.id, 1, undefined, heavy.id);
    await ctx.carts.add(cart.id, weightless.id);

    expect((await ctx.carts.price(cart.id)).weightGrams).toBe(1100);
  });
});

describe("a delivery rate by weight", () => {
  const address = {
    fullName: "Camille Dupont",
    line1: "12 rue des Orfèvres",
    locality: "Bruxelles",
    postalCode: "1000",
    country: "BE",
  };

  const bands = async (ctx: Ctx) => {
    const zone = await ctx.shipping.createZone({
      name: `Belgium ${randomUUID()}`,
      countries: ["BE"],
    });
    const light = `light-${randomUUID()}`;
    const heavy = `heavy-${randomUUID()}`;
    const any = `any-${randomUUID()}`;
    await ctx.shipping.createRate({
      zoneId: zone.id,
      code: light,
      name: "Up to 1 kg",
      price: 500,
      maxWeightGrams: 1000,
    });
    await ctx.shipping.createRate({
      zoneId: zone.id,
      code: heavy,
      name: "1 to 5 kg",
      price: 1200,
      minWeightGrams: 1000,
      maxWeightGrams: 5000,
    });
    await ctx.shipping.createRate({
      zoneId: zone.id,
      code: any,
      name: "Courier",
      price: 3000,
    });
    return { light, heavy, any };
  };

  it("is offered within its band", async ({ expect }) => {
    const ctx = await setup();
    const { light, any } = await bands(ctx);

    const quotes = await ctx.shipping.quote("BE", 8000, { weightGrams: 400 });

    expect(quotes.map((it) => it.code)).toEqual([light, any]);
  });

  it("puts an exact limit in the lower band", async ({ expect }) => {
    const ctx = await setup();
    const { light, any } = await bands(ctx);

    const quotes = await ctx.shipping.quote("BE", 8000, { weightGrams: 1000 });

    expect(quotes.map((it) => it.code)).toEqual([light, any]);
  });

  it("is passed over beyond it", async ({ expect }) => {
    const ctx = await setup();
    const { heavy, any } = await bands(ctx);

    const quotes = await ctx.shipping.quote("BE", 8000, { weightGrams: 1001 });

    expect(quotes.map((it) => it.code)).toEqual([heavy, any]);
  });

  it("follows the cart at checkout", async ({ expect }) => {
    const ctx = await setup();
    const { light, heavy } = await bands(ctx);
    const piece = await aPiece(ctx, { weightGrams: 600 });
    const cart = await ctx.carts.resolve(ctx.carts.newToken());
    await ctx.carts.add(cart.id, piece.id, 1);
    const opened = await ctx.checkout.start(cart.id);
    await ctx.checkout.setAddress(opened.id, address);

    const one = await ctx.checkout.shippingOptions(opened.id);
    await ctx.carts.add(cart.id, piece.id, 1);
    const two = await ctx.checkout.shippingOptions(opened.id);

    expect(one.map((it) => it.code)).toContain(light);
    expect(two.map((it) => it.code)).toContain(heavy);
    expect(two.map((it) => it.code)).not.toContain(light);
  });

  it("refuses to take payment on a band the cart has left", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { light } = await bands(ctx);
    const piece = await aPiece(ctx, { weightGrams: 600 });
    const cart = await ctx.carts.resolve(ctx.carts.newToken());
    await ctx.carts.add(cart.id, piece.id, 1);
    const opened = await ctx.checkout.start(cart.id);
    await ctx.checkout.setAddress(opened.id, address);
    await ctx.checkout.setShippingMethod(opened.id, light);

    await ctx.carts.add(cart.id, piece.id, 1);

    await expect(
      ctx.checkout.pay(opened.id, { returnUrl: "https://shop.example/thanks" }),
    ).rejects.toThrow(/no longer available/);
  });

  it("is written from the back office", async ({ expect }) => {
    const ctx = await setup();
    const zone = await ctx.shipping.createZone({
      name: `Spain ${randomUUID()}`,
      countries: ["ES"],
    });

    const { data } =
      await ctx.adminShipping.commerceAdminShippingCreateRate.fetch(
        {
          params: { zoneId: zone.id },
          body: {
            code: `bulky-${randomUUID()}`,
            name: "Bulky",
            price: 900,
            minWeightGrams: 2000,
          },
        },
        admin,
      );

    expect(data.minWeightGrams).toBe(2000);
  });
});
