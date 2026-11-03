import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { AdminProductController } from "../admin/controllers/AdminProductController.ts";
import { AlephaCommerceAdmin } from "../admin/index.ts";
import { CartService } from "../cart/services/CartService.ts";
import { AddressRulesProvider } from "../checkout/providers/AddressRulesProvider.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { ProductController } from "../controllers/ProductController.ts";
import { AlephaCommerceInvoicing } from "../invoicing/index.ts";
import { ExchangeRateProvider } from "../invoicing/providers/ExchangeRateProvider.ts";
import { HtmlInvoiceRenderer } from "../invoicing/providers/HtmlInvoiceRenderer.ts";
import { InvoiceService } from "../invoicing/services/InvoiceService.ts";
import { orderConfig } from "../orderConfigAtom.ts";
import { AlephaCommercePromotions } from "../promotions/index.ts";
import { PromotionService } from "../promotions/services/PromotionService.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { PriceListService } from "../services/PriceListService.ts";
import { StockService } from "../services/StockService.ts";
import { VariantService } from "../services/VariantService.ts";
import { AlephaCommerceShipping } from "../shipping/index.ts";
import { ShippingService } from "../shipping/services/ShippingService.ts";

class EuroPerDollar extends ExchangeRateProvider {
  public override async rate(from: string, to: string) {
    return from === "USD" && to === "EUR" ? 0.9 : undefined;
  }
}

class WithTheStates extends AddressRulesProvider {
  public override rules() {
    return {
      ...super.rules(),
      US: { name: "United States", postalCode: /^\d{5}$/, example: "02108" },
    };
  }
}

const setup = async (options: { rates?: boolean } = {}) => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with({ provide: AddressRulesProvider, use: WithTheStates });
  if (options.rates) {
    alepha.with({ provide: ExchangeRateProvider, use: EuroPerDollar });
  }
  alepha
    .with(AlephaCommerceShipping)
    .with(AlephaCommerceInvoicing)
    .with(AlephaCommercePromotions)
    .with(AlephaCommerceAdmin);
  const ctx = {
    alepha,
    adminProducts: alepha.inject(AdminProductController),
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    checkout: alepha.inject(CheckoutService),
    invoices: alepha.inject(InvoiceService),
    orders: alepha.inject(OrderService),
    payments: alepha.inject(PaymentService),
    prices: alepha.inject(PriceListService),
    productApi: alepha.inject(ProductController),
    promotions: alepha.inject(PromotionService),
    renderer: alepha.inject(HtmlInvoiceRenderer),
    shipping: alepha.inject(ShippingService),
    stock: alepha.inject(StockService),
    variants: alepha.inject(VariantService),
  };
  await alepha.start();
  alepha.store.set(orderConfig.key, {
    ...alepha.store.get(orderConfig.key)!,
    currencies: ["EUR", "USD", "CHF"],
  });
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const aRing = async (
  ctx: Ctx,
  usd: number | null = 9900,
  data: { name?: string; price?: number } = {},
) => {
  const ring = await ctx.catalog.create({
    slug: `ring-${randomUUID()}`,
    name: "Ring",
    price: 8900,
    published: true,
    config: { trackStock: true },
    ...data,
  });
  await ctx.stock.recordIntake(ring.id, 5);
  if (usd !== null) {
    await ctx.prices.set(ring, { currency: "USD", price: usd });
  }
  return ring;
};

const aCart = async (ctx: Ctx, currency?: string) => {
  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  if (currency) {
    await ctx.carts.setCurrency(cart.id, currency);
  }
  return cart;
};

/**
 * A zone delivering to the US, with a rate in dollars and one in euros.
 */
const aDeliveryZone = async (ctx: Ctx) => {
  const zone = await ctx.shipping.createZone({
    name: `Export ${randomUUID()}`,
    countries: ["US"],
  });
  const euros = `air-eur-${randomUUID()}`;
  const dollars = `air-usd-${randomUUID()}`;
  await ctx.shipping.createRate({
    zoneId: zone.id,
    code: euros,
    name: "Air EUR",
    price: 1500,
  });
  await ctx.shipping.createRate({
    zoneId: zone.id,
    code: dollars,
    name: "Air USD",
    price: 1800,
    currency: "USD",
  });
  return { euros, dollars };
};

const address = {
  fullName: "Sam Rivera",
  line1: "1 Main Street",
  locality: "Boston",
  postalCode: "02108",
  country: "US",
};

describe("a price list", () => {
  it("prices a cart in the buyer's currency", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx);
    const cart = await aCart(ctx, "USD");

    await ctx.carts.add(cart.id, ring.id, 2);
    const priced = await ctx.carts.price(cart.id);

    expect(priced.currency).toBe("USD");
    expect(priced.lines[0]!.unitPrice).toBe(9900);
    expect(priced.subtotal).toBe(19800);
  });

  it("leaves a cart that chose nothing in the product's own currency", async ({
    expect,
  }) => {
    const ctx = await setup();
    const ring = await aRing(ctx);
    const cart = await aCart(ctx);

    await ctx.carts.add(cart.id, ring.id);
    const priced = await ctx.carts.price(cart.id);

    expect(priced.currency).toBe("EUR");
    expect(priced.subtotal).toBe(8900);
  });

  it("goes back to the catalogue price in the product's own currency", async ({
    expect,
  }) => {
    const ctx = await setup();
    const ring = await aRing(ctx);
    const cart = await aCart(ctx, "USD");
    await ctx.carts.add(cart.id, ring.id);

    await ctx.carts.setCurrency(cart.id, "EUR");

    expect((await ctx.carts.price(cart.id)).subtotal).toBe(8900);
  });

  it("refuses a currency the shop does not sell in", async ({ expect }) => {
    const ctx = await setup();
    const cart = await aCart(ctx);

    await expect(ctx.carts.setCurrency(cart.id, "JPY")).rejects.toThrow(/JPY/);
  });

  it("refuses to switch a cart holding what has no price there", async ({
    expect,
  }) => {
    const ctx = await setup();
    const ring = await aRing(ctx, null, { name: "Euro ring" });
    const cart = await aCart(ctx);
    await ctx.carts.add(cart.id, ring.id);

    await expect(ctx.carts.setCurrency(cart.id, "USD")).rejects.toThrow(
      /Euro ring/,
    );
    expect((await ctx.carts.price(cart.id)).currency).toBe("EUR");
  });

  it("refuses to add what has no price in the cart's currency", async ({
    expect,
  }) => {
    const ctx = await setup();
    const ring = await aRing(ctx, null);
    const cart = await aCart(ctx, "USD");

    await expect(ctx.carts.add(cart.id, ring.id)).rejects.toThrow(/USD/);
  });

  it("gives a line up when its price is taken off", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx);
    const cart = await aCart(ctx, "USD");
    await ctx.carts.add(cart.id, ring.id);

    await ctx.prices.remove(ring.id, { currency: "USD" });

    expect((await ctx.carts.price(cart.id)).lines).toHaveLength(0);
  });

  it("replaces a price rather than adding a second", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx);

    await ctx.prices.set(ring, { currency: "USD", price: 10500 });

    expect(await ctx.prices.listOf(ring.id)).toHaveLength(1);
    expect((await ctx.prices.listOf(ring.id))[0]!.price).toBe(10500);
  });

  it("refuses a price in the product's own currency", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx);

    await expect(
      ctx.prices.set(ring, { currency: "EUR", price: 100 }),
    ).rejects.toThrow(/EUR/);
  });

  describe("with variants", () => {
    const aSizedRing = async (ctx: Ctx) => {
      const ring = await aRing(ctx);
      const plain = await ctx.variants.create(ring.id, {
        sku: `plain-${randomUUID()}`,
        options: { Taille: "52" },
      });
      const large = await ctx.variants.create(ring.id, {
        sku: `large-${randomUUID()}`,
        options: { Taille: "60" },
        price: 12000,
      });
      await ctx.stock.recordIntake(ring.id, 3, { variantId: plain.id });
      await ctx.stock.recordIntake(ring.id, 3, { variantId: large.id });
      return { ring, plain, large };
    };

    it("takes the product's price for a variant with none of its own", async ({
      expect,
    }) => {
      const ctx = await setup();
      const { ring, plain } = await aSizedRing(ctx);
      const cart = await aCart(ctx, "USD");

      await ctx.carts.add(cart.id, ring.id, 1, undefined, plain.id);

      expect((await ctx.carts.price(cart.id)).subtotal).toBe(9900);
    });

    it("never sells a dearer variant at the product's foreign price", async ({
      expect,
    }) => {
      const ctx = await setup();
      const { ring, large } = await aSizedRing(ctx);
      const cart = await aCart(ctx, "USD");

      await expect(
        ctx.carts.add(cart.id, ring.id, 1, undefined, large.id),
      ).rejects.toThrow(/USD/);
    });

    it("takes the variant's own row first", async ({ expect }) => {
      const ctx = await setup();
      const { ring, large } = await aSizedRing(ctx);
      await ctx.prices.set(ring, {
        currency: "USD",
        price: 13500,
        variantId: large.id,
      });
      const cart = await aCart(ctx, "USD");

      await ctx.carts.add(cart.id, ring.id, 1, undefined, large.id);

      expect((await ctx.carts.price(cart.id)).subtotal).toBe(13500);
    });
  });
});

describe("a checkout in the buyer's currency", () => {
  const reachPayment = async (ctx: Ctx) => {
    const { dollars } = await aDeliveryZone(ctx);
    const ring = await aRing(ctx);
    const cart = await aCart(ctx, "USD");
    await ctx.carts.add(cart.id, ring.id);
    const opened = await ctx.checkout.start(cart.id);
    await ctx.checkout.setAddress(opened.id, address);
    await ctx.checkout.setShippingMethod(opened.id, dollars);
    return { opened, ring, cart };
  };

  it("charges the order, the session and the intent in it", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { opened } = await reachPayment(ctx);

    const { session, handoff } = await ctx.checkout.pay(opened.id, {
      returnUrl: "https://bijoux.example/merci",
    });

    const order = await ctx.orders.getById(session.orderId!);
    const intent = await ctx.payments.getIntent(handoff.intentId);
    expect(order.currency).toBe("USD");
    expect(order.total).toBe(9900 + 1800);
    expect(session.currency).toBe("USD");
    expect(intent.currency).toBe("usd");
    expect(intent.amount).toBe(9900 + 1800);
  });

  it("offers only the delivery rates of that currency", async ({ expect }) => {
    const ctx = await setup();
    const { euros, dollars } = await aDeliveryZone(ctx);
    const ring = await aRing(ctx);
    const cart = await aCart(ctx, "USD");
    await ctx.carts.add(cart.id, ring.id);
    const opened = await ctx.checkout.start(cart.id);
    await ctx.checkout.setAddress(opened.id, address);

    const offered = await ctx.checkout.shippingOptions(opened.id);

    expect(offered.map((it) => it.code)).toEqual([dollars]);
    await expect(
      ctx.checkout.setShippingMethod(opened.id, euros),
    ).rejects.toThrow();
  });

  it("keeps a rate with no currency to the shop's own", async ({ expect }) => {
    const ctx = await setup();
    const { euros } = await aDeliveryZone(ctx);
    const ring = await aRing(ctx);
    const cart = await aCart(ctx);
    await ctx.carts.add(cart.id, ring.id);
    const opened = await ctx.checkout.start(cart.id);
    await ctx.checkout.setAddress(opened.id, address);

    const offered = await ctx.checkout.shippingOptions(opened.id);

    expect(offered.map((it) => it.code)).toEqual([euros]);
  });

  it("issues the invoice in it", async ({ expect }) => {
    const ctx = await setup();
    const { opened } = await reachPayment(ctx);
    const { session, handoff } = await ctx.checkout.pay(opened.id, {
      returnUrl: "https://bijoux.example/merci",
    });
    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

    const invoice = await ctx.invoices.issueForOrder(session.orderId!);
    const { body } = await ctx.renderer.render(invoice);

    expect(invoice.currency).toBe("USD");
    expect(invoice.grandTotal).toBe(11700);
    expect(body).toContain("117.00 USD");
  });

  describe("the VAT in the seller's own currency", () => {
    const anInvoice = async (ctx: Ctx) => {
      const { opened } = await reachPayment(ctx);
      const { session, handoff } = await ctx.checkout.pay(opened.id, {
        returnUrl: "https://bijoux.example/merci",
      });
      await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
      return ctx.invoices.issueForOrder(session.orderId!);
    };

    it("is frozen on the invoice at the rate of the day", async ({
      expect,
    }) => {
      const ctx = await setup({ rates: true });

      const invoice = await anInvoice(ctx);
      const { body } = await ctx.renderer.render(invoice);

      expect(invoice.vatTotal).toBeGreaterThan(0);
      expect(invoice.booksVat).toEqual({
        currency: "EUR",
        rate: 0.9,
        vatTotal: Math.round(invoice.vatTotal * 0.9),
      });
      expect(body).toContain("EUR");
    });

    it("keeps the invoice's rate on the credit note", async ({ expect }) => {
      const ctx = await setup({ rates: true });
      const invoice = await anInvoice(ctx);

      const note = await ctx.invoices.creditNote(invoice.id);

      expect(note.booksVat).toEqual({
        currency: "EUR",
        rate: 0.9,
        vatTotal: -Math.round(invoice.vatTotal * 0.9),
      });
    });

    it("is left out, and the sale goes on, with no rate to read", async ({
      expect,
    }) => {
      const ctx = await setup();

      const invoice = await anInvoice(ctx);

      expect(invoice.booksVat).toBeUndefined();
    });

    it("is not asked for on a sale in the seller's currency", async ({
      expect,
    }) => {
      const ctx = await setup({ rates: true });
      const { euros } = await aDeliveryZone(ctx);
      const ring = await aRing(ctx);
      const cart = await aCart(ctx);
      await ctx.carts.add(cart.id, ring.id);
      const opened = await ctx.checkout.start(cart.id);
      await ctx.checkout.setAddress(opened.id, address);
      await ctx.checkout.setShippingMethod(opened.id, euros);
      const { session, handoff } = await ctx.checkout.pay(opened.id, {
        returnUrl: "https://bijoux.example/merci",
      });
      await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

      const invoice = await ctx.invoices.issueForOrder(session.orderId!);

      expect(invoice.booksVat).toBeUndefined();
    });
  });
});

describe("signing in", () => {
  it("keeps the currency chosen on the way, over an empty cart", async ({
    expect,
  }) => {
    const ctx = await setup();
    const ring = await aRing(ctx);
    const anonymous = await aCart(ctx, "USD");
    await ctx.carts.add(anonymous.id, ring.id);
    const owned = await aCart(ctx);

    await ctx.carts.merge(anonymous.id, owned.id);

    expect((await ctx.carts.price(owned.id)).currency).toBe("USD");
    expect((await ctx.carts.price(owned.id)).subtotal).toBe(9900);
  });

  it("leaves behind what has no price in the cart it joins", async ({
    expect,
  }) => {
    const ctx = await setup();
    const held = await aRing(ctx);
    const euroOnly = await aRing(ctx, null);
    const anonymous = await aCart(ctx);
    await ctx.carts.add(anonymous.id, euroOnly.id);
    const owned = await aCart(ctx, "USD");
    await ctx.carts.add(owned.id, held.id);

    await ctx.carts.merge(anonymous.id, owned.id);

    const priced = await ctx.carts.price(owned.id);
    expect(priced.lines.map((it) => it.productId)).toEqual([held.id]);
  });
});

describe("an order placed through the API in a currency", () => {
  it("is priced from that list", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx);

    const order = await ctx.orders.create({
      lines: [{ productId: ring.id, quantity: 1 }],
      currency: "USD",
    });

    expect(order.total).toBe(9900);
    expect(order.currency).toBe("USD");
  });

  it("refuses a line with no price there", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx, null);

    await expect(
      ctx.orders.create({
        lines: [{ productId: ring.id, quantity: 1 }],
        currency: "USD",
      }),
    ).rejects.toThrow(/USD/);
  });

  it("still refuses to mix currencies when none was named", async ({
    expect,
  }) => {
    const ctx = await setup();
    const euros = await aRing(ctx, null);
    const dollars = await ctx.catalog.create({
      slug: `pendant-${randomUUID()}`,
      name: "Pendant",
      price: 12000,
      currency: "USD",
      published: true,
    });

    await expect(
      ctx.orders.create({
        lines: [
          { productId: euros.id, quantity: 1 },
          { productId: dollars.id, quantity: 1 },
        ],
      }),
    ).rejects.toThrow(/mixing currencies/);
  });
});

describe("a promotion", () => {
  const aCartInDollars = async (ctx: Ctx) => {
    const ring = await aRing(ctx);
    const cart = await aCart(ctx, "USD");
    await ctx.carts.add(cart.id, ring.id);
    return cart;
  };

  it("in euros is refused on a dollar cart", async ({ expect }) => {
    const ctx = await setup();
    const code = `TEN${randomUUID().slice(0, 8)}`;
    await ctx.promotions.create({
      name: "Ten off",
      code,
      kind: "amount",
      value: 1000,
    });
    const cart = await aCartInDollars(ctx);

    await expect(ctx.carts.applyCode(cart.id, code)).rejects.toThrow(
      /currency/,
    );
  });

  it("in dollars applies to a dollar cart", async ({ expect }) => {
    const ctx = await setup();
    const code = `TEN${randomUUID().slice(0, 8)}`;
    await ctx.promotions.create({
      name: "Ten off",
      code,
      kind: "amount",
      value: 1000,
      currency: "USD",
    });
    const cart = await aCartInDollars(ctx);

    await ctx.carts.applyCode(cart.id, code);

    expect((await ctx.carts.price(cart.id)).discountTotal).toBe(1000);
  });

  it("in percent applies in any currency", async ({ expect }) => {
    const ctx = await setup();
    const code = `PCT${randomUUID().slice(0, 8)}`;
    await ctx.promotions.create({
      name: "Ten percent",
      code,
      kind: "percent",
      value: 1000,
    });
    const cart = await aCartInDollars(ctx);

    await ctx.carts.applyCode(cart.id, code);

    expect((await ctx.carts.price(cart.id)).discountTotal).toBe(990);
  });

  it("with a minimum in euros is refused on a dollar cart", async ({
    expect,
  }) => {
    const ctx = await setup();
    const code = `PCT${randomUUID().slice(0, 8)}`;
    await ctx.promotions.create({
      name: "Ten percent",
      code,
      kind: "percent",
      value: 1000,
      minSubtotal: 100,
    });
    const cart = await aCartInDollars(ctx);

    await expect(ctx.carts.applyCode(cart.id, code)).rejects.toThrow(
      /currency/,
    );
  });
});

describe("the storefront", () => {
  it("lists what sells in a currency, at that price", async ({ expect }) => {
    const ctx = await setup();
    const sold = await aRing(ctx);
    const unsold = await aRing(ctx, null);

    const page = await ctx.productApi.commerceProductList.run({
      query: { currency: "USD" },
    });

    const ids = page.content.map((it) => it.id);
    expect(ids).toContain(sold.id);
    expect(ids).not.toContain(unsold.id);
    const row = page.content.find((it) => it.id === sold.id)!;
    expect(row.price).toBe(9900);
    expect(row.currency).toBe("USD");
  });

  it("filters a price range in that currency", async ({ expect }) => {
    const ctx = await setup();
    const cheap = await aRing(ctx, 5000, { price: 90000 });
    const dear = await aRing(ctx, 70000, { price: 1000 });

    const page = await ctx.productApi.commerceProductList.run({
      query: { currency: "USD", maxPrice: 6000 },
    });

    const ids = page.content.map((it) => it.id);
    expect(ids).toContain(cheap.id);
    expect(ids).not.toContain(dear.id);
  });

  it("answers a product in that currency", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx);

    const product = await ctx.productApi.commerceProductGetBySlug.run({
      params: { slug: ring.slug },
      query: { currency: "USD" },
    });

    expect(product.price).toBe(9900);
    expect(product.currency).toBe("USD");
  });

  it("does not sell a product with no price there", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx, null);

    await expect(
      ctx.productApi.commerceProductGetBySlug.run({
        params: { slug: ring.slug },
        query: { currency: "USD" },
      }),
    ).rejects.toThrow();
  });

  it("offers a variant only at a price it has", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx);
    const plain = await ctx.variants.create(ring.id, {
      sku: `plain-${randomUUID()}`,
      options: { Taille: "52" },
    });
    await ctx.variants.create(ring.id, {
      sku: `large-${randomUUID()}`,
      options: { Taille: "60" },
      price: 12000,
    });

    const product = await ctx.productApi.commerceProductGetBySlug.run({
      params: { slug: ring.slug },
      query: { currency: "USD" },
    });

    expect(product.variants?.map((it) => it.id)).toEqual([plain.id]);
    expect(product.variants?.[0]!.price).toBe(9900);
  });

  it("names what the shop sells in, on the cart", async ({ expect }) => {
    const ctx = await setup();
    const prices = await ctx.adminProducts.commerceAdminProductPrices.fetch(
      { params: { id: (await aRing(ctx)).id } },
      { user: { id: randomUUID(), roles: ["admin"] } },
    );

    expect(prices.data.currencies).toEqual(["EUR", "USD", "CHF"]);
    expect(prices.data.prices).toHaveLength(1);
  });
});
