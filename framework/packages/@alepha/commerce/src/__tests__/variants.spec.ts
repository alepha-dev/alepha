import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { AdminProductController } from "../admin/controllers/AdminProductController.ts";
import { AlephaCommerceAdmin } from "../admin/index.ts";
import { CartService } from "../cart/services/CartService.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { ProductController } from "../controllers/ProductController.ts";
import { AlephaCommerceInvoicing } from "../invoicing/index.ts";
import { InvoiceService } from "../invoicing/services/InvoiceService.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { StockService } from "../services/StockService.ts";
import { VariantService } from "../services/VariantService.ts";

const setup = async (backend: "postgres" | "sqlite" = "postgres") => {
  const alepha =
    backend === "postgres"
      ? Alepha.create()
          .with(AlephaOrmPostgres)
          .with(AlephaCommerceInvoicing)
          .with(AlephaCommerceAdmin)
      : Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } })
          .with(AlephaCommerceInvoicing)
          .with(AlephaCommerceAdmin);
  const ctx = {
    alepha,
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    checkout: alepha.inject(CheckoutService),
    invoices: alepha.inject(InvoiceService),
    orders: alepha.inject(OrderService),
    payments: alepha.inject(PaymentService),
    productApi: alepha.inject(ProductController),
    adminProducts: alepha.inject(AdminProductController),
    stock: alepha.inject(StockService),
    variants: alepha.inject(VariantService),
  };
  await alepha.start();
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

/**
 * A ring in two sizes, the larger one dearer, three of each in stock.
 */
const aRing = async (ctx: Ctx) => {
  const id = randomUUID();
  const ring = await ctx.catalog.create({
    slug: `ring-${id}`,
    name: "Bague Aurore",
    price: 8900,
    published: true,
    config: { trackStock: true },
    optionGroups: [{ name: "Taille", values: ["52", "56"] }],
  });
  const small = await ctx.variants.create(ring.id, {
    sku: `RING-52-${id}`,
    options: { Taille: "52" },
  });
  const large = await ctx.variants.create(ring.id, {
    sku: `RING-56-${id}`,
    options: { Taille: "56" },
    price: 9500,
  });
  await ctx.stock.recordIntake(ring.id, 3, { variantId: small.id });
  await ctx.stock.recordIntake(ring.id, 3, { variantId: large.id });
  return { ring, small, large };
};

const aCart = async (ctx: Ctx) => ctx.carts.resolve(ctx.carts.newToken());

describe("product variants", () => {
  describe("the stock ledger", () => {
    it("keeps each variant's figures apart and sums them under the product", async ({
      expect,
    }) => {
      const ctx = await setup();
      const { ring, small, large } = await aRing(ctx);

      await ctx.stock.recordIntake(ring.id, 2, { variantId: small.id });

      expect(await ctx.stock.onHand(ring.id, small.id)).toBe(5);
      expect(await ctx.stock.onHand(ring.id, large.id)).toBe(3);
      expect(await ctx.stock.onHand(ring.id)).toBe(8);
    });

    it("lets a hold on one size leave the other alone", async ({ expect }) => {
      const ctx = await setup();
      const { ring, small, large } = await aRing(ctx);

      await ctx.stock.reserve(ring.id, 3, {
        orderId: randomUUID(),
        variantId: small.id,
      });

      expect(await ctx.stock.available(ring.id, small.id)).toBe(0);
      expect(await ctx.stock.available(ring.id, large.id)).toBe(3);
      await expect(
        ctx.stock.reserve(ring.id, 1, {
          orderId: randomUUID(),
          variantId: small.id,
        }),
      ).rejects.toThrow(/Insufficient stock/);
    });
  });

  describe("the cart", () => {
    it("refuses a line with no variant on a product that has them", async ({
      expect,
    }) => {
      const ctx = await setup();
      const { ring } = await aRing(ctx);
      const cart = await aCart(ctx);

      await expect(ctx.carts.add(cart.id, ring.id, 1)).rejects.toThrow(
        /choose a variant/,
      );
    });

    it("refuses a variant of another product", async ({ expect }) => {
      const ctx = await setup();
      const { ring } = await aRing(ctx);
      const other = await aRing(ctx);
      const cart = await aCart(ctx);

      await expect(
        ctx.carts.add(cart.id, ring.id, 1, undefined, other.small.id),
      ).rejects.toThrow(/not on sale/);
    });

    it("refuses a variant that was switched off", async ({ expect }) => {
      const ctx = await setup();
      const { ring, small } = await aRing(ctx);
      await ctx.variants.update(small.id, { active: false });
      const cart = await aCart(ctx);

      await expect(
        ctx.carts.add(cart.id, ring.id, 1, undefined, small.id),
      ).rejects.toThrow(/not on sale/);
    });

    it("refuses a variant on a product that has none", async ({ expect }) => {
      const ctx = await setup();
      const plain = await ctx.catalog.create({
        slug: `plain-${randomUUID()}`,
        name: "Chaîne",
        price: 4000,
        published: true,
      });
      const cart = await aCart(ctx);

      await expect(
        ctx.carts.add(cart.id, plain.id, 1, undefined, randomUUID()),
      ).rejects.toThrow(/has no variants/);
    });

    it("merges two adds of one variant and keeps two variants apart", async ({
      expect,
    }) => {
      const ctx = await setup();
      const { ring, small, large } = await aRing(ctx);
      const cart = await aCart(ctx);

      await ctx.carts.add(cart.id, ring.id, 1, undefined, small.id);
      await ctx.carts.add(cart.id, ring.id, 1, undefined, small.id);
      await ctx.carts.add(cart.id, ring.id, 1, undefined, large.id);

      const priced = await ctx.carts.price(cart.id);
      expect(priced.lines.map((l) => [l.variantId, l.quantity])).toEqual([
        [small.id, 2],
        [large.id, 1],
      ]);
    });

    it("prices each line at its variant, or the product without an override", async ({
      expect,
    }) => {
      const ctx = await setup();
      const { ring, small, large } = await aRing(ctx);
      const cart = await aCart(ctx);

      await ctx.carts.add(cart.id, ring.id, 1, undefined, small.id);
      await ctx.carts.add(cart.id, ring.id, 1, undefined, large.id);

      const priced = await ctx.carts.price(cart.id);
      expect(priced.lines.map((l) => l.unitPrice)).toEqual([8900, 9500]);
      expect(priced.subtotal).toBe(18400);
      expect(priced.lines.map((l) => l.variantLabel)).toEqual(["52", "56"]);
    });

    it("drops a line whose variant was switched off", async ({ expect }) => {
      const ctx = await setup();
      const { ring, small } = await aRing(ctx);
      const cart = await aCart(ctx);
      await ctx.carts.add(cart.id, ring.id, 1, undefined, small.id);

      await ctx.variants.update(small.id, { active: false });

      expect((await ctx.carts.price(cart.id)).lines).toHaveLength(0);
    });
  });

  describe("an order", () => {
    /*
     * The whole way through, on both ledger paths: Postgres locks the variant,
     * SQLite replays it.
     */
    describe.each(["postgres", "sqlite"] as const)("on %s", (backend) => {
      it("holds, sells and snapshots the variant", async ({ expect }) => {
        const ctx = await setup(backend);
        const { ring, small, large } = await aRing(ctx);
        const cart = await aCart(ctx);
        await ctx.carts.add(cart.id, ring.id, 2, undefined, large.id);

        const opened = await ctx.checkout.start(cart.id);
        const { session, handoff } = await ctx.checkout.pay(opened.id, {
          returnUrl: "https://bijoux.example/merci",
        });
        const orderId = session.orderId!;

        expect(await ctx.stock.available(ring.id, large.id)).toBe(1);
        expect(await ctx.stock.available(ring.id, small.id)).toBe(3);

        await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

        expect(await ctx.stock.onHand(ring.id, large.id)).toBe(1);
        expect(await ctx.stock.onHand(ring.id, small.id)).toBe(3);

        const order = await ctx.orders.getById(orderId);
        expect(order.total).toBe(19000);
        const [item] = await ctx.orders.itemsOf(orderId);
        expect(item!.variantId).toBe(large.id);
        expect(item!.sku).toBe(large.sku);
        expect(item!.variantLabel).toBe("56");
        expect(item!.unitPrice).toBe(9500);
      });

      it("gives a refunded variant back to that variant", async ({
        expect,
      }) => {
        const ctx = await setup(backend);
        const { ring, large } = await aRing(ctx);
        const order = await ctx.orders.create({
          status: "paid",
          lines: [{ productId: ring.id, quantity: 1, variantId: large.id }],
        });

        await ctx.orders.refund(order.id);

        expect(await ctx.stock.onHand(ring.id, large.id)).toBe(3);
      });
    });

    it("refuses a line with no variant, whoever creates the order", async ({
      expect,
    }) => {
      const ctx = await setup();
      const { ring } = await aRing(ctx);

      await expect(
        ctx.orders.create({ lines: [{ productId: ring.id, quantity: 1 }] }),
      ).rejects.toThrow(/choose a variant/);
    });
  });

  describe("the invoice", () => {
    it("names the variant and freezes its SKU", async ({ expect }) => {
      const ctx = await setup();
      const { ring, large } = await aRing(ctx);
      const order = await ctx.orders.create({
        status: "paid",
        lines: [{ productId: ring.id, quantity: 1, variantId: large.id }],
      });

      const invoice = await ctx.invoices.issueForOrder(order.id);

      const [line] = invoice.lines;
      expect(line!.description).toBe("Bague Aurore (56)");
      expect(line!.sku).toBe(large.sku);
    });
  });

  describe("the public catalogue", () => {
    it("answers the options and each variant's figures on the detail", async ({
      expect,
    }) => {
      const ctx = await setup();
      const { ring, small, large } = await aRing(ctx);

      const { data } = await ctx.productApi.commerceProductGetBySlug.fetch({
        params: { slug: ring.slug },
      });

      expect(data.optionGroups).toEqual([
        { name: "Taille", values: ["52", "56"] },
      ]);
      expect(data.available).toBe(6);
      expect(data.variants).toEqual([
        {
          id: small.id,
          options: { Taille: "52" },
          price: 8900,
          available: 3,
        },
        {
          id: large.id,
          options: { Taille: "56" },
          price: 9500,
          available: 3,
        },
      ]);
    });

    it("leaves a switched-off variant out", async ({ expect }) => {
      const ctx = await setup();
      const { ring, small, large } = await aRing(ctx);
      await ctx.variants.update(small.id, { active: false });

      const { data } = await ctx.productApi.commerceProductGetBySlug.fetch({
        params: { slug: ring.slug },
      });

      expect(data.variants?.map((it) => it.id)).toEqual([large.id]);
      expect(data.available).toBe(3);
    });

    it("gives the list the lowest price and the sum of the stock", async ({
      expect,
    }) => {
      const ctx = await setup();
      const { ring } = await aRing(ctx);

      const { data } = await ctx.productApi.commerceProductList.fetch({
        query: { size: 100 },
      });

      const row = data.content.find((it) => it.id === ring.id)!;
      expect(row.priceFrom).toBe(8900);
      expect(row.available).toBe(6);
    });
  });

  describe("the back office", () => {
    const admin = { id: randomUUID(), roles: ["admin"] };

    it("generates the combinations of the option groups, once", async ({
      expect,
    }) => {
      const ctx = await setup();
      const product = await ctx.catalog.create({
        slug: `shirt-${randomUUID()}`,
        name: "Chemise",
        price: 6000,
        optionGroups: [
          { name: "Taille", values: ["S", "M"] },
          { name: "Couleur", values: ["Bleu", "Blanc"] },
        ],
      });

      await ctx.adminProducts.commerceAdminProductVariantsGenerate.fetch(
        { params: { id: product.id } },
        { user: admin },
      );
      const { data } =
        await ctx.adminProducts.commerceAdminProductVariantsGenerate.fetch(
          { params: { id: product.id } },
          { user: admin },
        );

      expect(data.map((it) => it.options)).toEqual([
        { Taille: "S", Couleur: "Bleu" },
        { Taille: "S", Couleur: "Blanc" },
        { Taille: "M", Couleur: "Bleu" },
        { Taille: "M", Couleur: "Blanc" },
      ]);
    });

    it("corrects one variant's stock", async ({ expect }) => {
      const ctx = await setup();
      const { ring, small } = await aRing(ctx);

      await ctx.adminProducts.commerceAdminProductAdjustStock.fetch(
        {
          params: { id: ring.id },
          body: { quantity: -1, reason: "adjustment", variantId: small.id },
        },
        { user: admin },
      );

      expect(await ctx.stock.onHand(ring.id, small.id)).toBe(2);
    });

    it("refuses a stock correction that names no variant", async ({
      expect,
    }) => {
      const ctx = await setup();
      const { ring } = await aRing(ctx);

      await expect(
        ctx.adminProducts.commerceAdminProductAdjustStock.fetch(
          {
            params: { id: ring.id },
            body: { quantity: 1, reason: "intake" },
          },
          { user: admin },
        ),
      ).rejects.toThrow(/choose a variant/);
    });

    it("refuses to delete a variant that has sold", async ({ expect }) => {
      const ctx = await setup();
      const { ring, large } = await aRing(ctx);
      await ctx.orders.create({
        status: "paid",
        lines: [{ productId: ring.id, quantity: 1, variantId: large.id }],
      });

      await expect(ctx.variants.delete(large.id)).rejects.toThrow(
        /appears on 1 order line/,
      );
    });
  });
});
