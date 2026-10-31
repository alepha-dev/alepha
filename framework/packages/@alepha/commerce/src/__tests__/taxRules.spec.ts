import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import {
  VatNumberChecker,
  type VatNumberCheck,
} from "../checkout/providers/VatNumberChecker.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { taxConfig } from "../checkout/taxConfigAtom.ts";
import { AlephaCommerceInvoicing } from "../invoicing/index.ts";
import { HtmlInvoiceRenderer } from "../invoicing/providers/HtmlInvoiceRenderer.ts";
import { InvoiceService } from "../invoicing/services/InvoiceService.ts";
import { AlephaCommercePromotions } from "../promotions/index.ts";
import { PromotionService } from "../promotions/services/PromotionService.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { StockService } from "../services/StockService.ts";
import { AlephaCommerceShipping } from "../shipping/index.ts";
import { ShippingService } from "../shipping/services/ShippingService.ts";

/**
 * VIES, as far as these specs need it: `FR` and `DE` numbers ending in 1 are
 * good, `DOWN` is the service being away. The real one was called once by hand;
 * see the note on `ViesVatNumberChecker`.
 */
class FakeChecker extends VatNumberChecker {
  public override async check(vatNumber: string): Promise<VatNumberCheck> {
    if (vatNumber.includes("DOWN")) {
      return { status: "unavailable" };
    }
    return vatNumber.endsWith("1")
      ? { status: "valid", name: "ACME GMBH" }
      : { status: "invalid" };
  }
}

const de = {
  fullName: "Erika Mustermann",
  line1: "Unter den Linden 1",
  locality: "Berlin",
  postalCode: "10115",
  country: "DE",
};

const fr = {
  fullName: "Camille Dupont",
  line1: "12 rue des Orfèvres",
  locality: "Paris",
  postalCode: "75001",
  country: "FR",
};

const setup = async (config: Record<string, any> = {}) => {
  const alepha = Alepha.create()
    .with({ provide: VatNumberChecker, use: FakeChecker })
    .with(AlephaOrmPostgres)
    .with(AlephaCommercePromotions)
    .with(AlephaCommerceShipping)
    .with(AlephaCommerceInvoicing);

  const ctx = {
    alepha,
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    checkout: alepha.inject(CheckoutService),
    invoices: alepha.inject(InvoiceService),
    orders: alepha.inject(OrderService),
    payments: alepha.inject(PaymentService),
    promotions: alepha.inject(PromotionService),
    renderer: alepha.inject(HtmlInvoiceRenderer),
    shipping: alepha.inject(ShippingService),
    stock: alepha.inject(StockService),
  };
  await alepha.start();
  alepha.store.set(taxConfig.key, {
    ...alepha.store.get(taxConfig.key)!,
    ...config,
  });

  const zone = await ctx.shipping.createZone({
    name: "Europe",
    countries: ["FR", "DE"],
  });
  await ctx.shipping.createRate({
    zoneId: zone.id,
    code: `standard-${randomUUID()}`,
    name: "Standard",
    price: 1200,
  });
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const oss = {
  distanceSelling: true,
  countries: { DE: { standardBps: 1900, reduced: { "550": 700 } } },
};

const aCheckout = async (
  ctx: Ctx,
  address: typeof de,
  prices: Array<{ price: number; vatRateBps?: number }> = [{ price: 11900 }],
) => {
  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  for (const { price, vatRateBps } of prices) {
    const product = await ctx.catalog.create({
      slug: `piece-${randomUUID()}`,
      name: "Pièce",
      price,
      vatRateBps,
      published: true,
    });
    await ctx.stock.recordIntake(product.id, 5);
    await ctx.carts.add(cart.id, product.id, 1);
  }
  const opened = await ctx.checkout.start(cart.id);
  await ctx.checkout.setAddress(opened.id, address);
  return opened.id;
};

const choose = async (ctx: Ctx, sessionId: string) => {
  const [option] = await ctx.checkout.shippingOptions(sessionId);
  return ctx.checkout.setShippingMethod(sessionId, option!.code);
};

const pay = async (ctx: Ctx, sessionId: string) => {
  const { session, handoff } = await ctx.checkout.pay(sessionId, {
    returnUrl: "https://bijoux.example/merci",
  });
  await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
  return session.orderId!;
};

describe("the default rate", () => {
  it("is configuration, not a constant", async ({ expect }) => {
    const ctx = await setup({ defaultRateBps: 2100 });
    const id = await aCheckout(ctx, fr, [{ price: 12100 }]);

    const session = await choose(ctx, id);

    // 121 TTC at 21 % holds 21; delivery the same way.
    expect(session.taxTotal).toBe(2100 + 208);
  });
});

describe("distance selling", () => {
  it("is off by default: a foreign buyer pays the home rate", async ({
    expect,
  }) => {
    const ctx = await setup();
    const id = await aCheckout(ctx, de);

    const session = await ctx.checkout.getById(id);

    expect(session.taxTotal).toBe(1983 + 200);
  });

  it("charges the delivery country's rate, delivery included", async ({
    expect,
  }) => {
    const ctx = await setup(oss);
    const id = await aCheckout(ctx, de);

    const session = await choose(ctx, id);

    // 119 TTC at 19 % holds 19, and so 12 of delivery holds 1,92.
    expect(session.grandTotal).toBe(13100);
    expect(session.taxTotal).toBe(1900 + 192);
  });

  it("keeps the home rate at home", async ({ expect }) => {
    const ctx = await setup(oss);
    const id = await aCheckout(ctx, fr);

    const session = await choose(ctx, id);

    expect(session.taxTotal).toBe(1983 + 200);
  });

  it("maps a reduced rate to the destination's", async ({ expect }) => {
    const ctx = await setup(oss);
    const id = await aCheckout(ctx, de, [{ price: 10700, vatRateBps: 550 }]);

    const session = await ctx.checkout.getById(id);

    // The cheapest delivery is preselected, at DE's standard rate.
    expect(session.taxTotal).toBe(700 + 192);
  });

  it("freezes the rates on the order and the invoice", async ({ expect }) => {
    const ctx = await setup(oss);
    const id = await aCheckout(ctx, de);
    await choose(ctx, id);

    const orderId = await pay(ctx, id);

    const order = await ctx.orders.getById(orderId);
    expect(order.taxCountry).toBe("DE");
    const [item] = await ctx.orders.itemsOf(orderId);
    expect(item!.rateBps).toBe(1900);

    const invoice = await ctx.invoices.issueForOrder(orderId);
    expect(invoice.vatBuckets.map((it) => it.rateBps)).toEqual([1900]);
    expect(invoice.vatTotal).toBe(1900 + 192);
    expect(invoice.grandTotal).toBe(order.total);
  });

  it("refuses a country it has no rate for, rather than guess", async ({
    expect,
  }) => {
    const ctx = await setup({ distanceSelling: true, countries: {} });

    await expect(aCheckout(ctx, de)).rejects.toThrow(/No VAT rate.*DE/);
  });

  it("refuses a reduced rate with no equivalent", async ({ expect }) => {
    const ctx = await setup(oss);

    await expect(
      aCheckout(ctx, de, [{ price: 1000, vatRateBps: 1000 }]),
    ).rejects.toThrow(/No VAT rate.*DE/);
  });
});

describe("B2B reverse charge", () => {
  const b2b = { ...oss, reverseCharge: true };

  it("takes the VAT off for a valid number from another country", async ({
    expect,
  }) => {
    const ctx = await setup(b2b);
    const id = await aCheckout(ctx, de);

    await ctx.checkout.setVatNumber(id, "DE123456781");
    const session = await choose(ctx, id);

    // 119 TTC at the home rate of 20 % is 99,17 net; delivery 10 net.
    expect(session.taxTotal).toBe(0);
    expect(session.subtotal).toBe(9917);
    expect(session.shippingTotal).toBe(1000);
    expect(session.grandTotal).toBe(10917);
  });

  it("carries it through to the order and the invoice, with the mention", async ({
    expect,
  }) => {
    const ctx = await setup(b2b);
    const id = await aCheckout(ctx, de);
    await ctx.checkout.setVatNumber(id, "de 123 456 781");
    await choose(ctx, id);

    const orderId = await pay(ctx, id);

    const order = await ctx.orders.getById(orderId);
    expect(order.total).toBe(10917);
    expect(order.taxTotal).toBe(0);
    expect(order.vatNumber).toBe("DE123456781");

    const invoice = await ctx.invoices.issueForOrder(orderId);
    expect(invoice.vatTotal).toBe(0);
    expect(invoice.grandTotal).toBe(10917);
    expect(invoice.vatBuckets.map((it) => it.rateBps)).toEqual([0]);

    const { body } = await ctx.renderer.render(invoice);
    expect(body).toContain("DE123456781");
    expect(body).toContain("Autoliquidation");
  });

  it("keeps the arithmetic exact with a discount", async ({ expect }) => {
    const ctx = await setup(b2b);
    const code = `CODE${randomUUID().slice(0, 8)}`.toUpperCase();
    await ctx.promotions.create({
      name: "Dix pour cent",
      code,
      kind: "percent",
      value: 1000,
    });
    const cart = await ctx.carts.resolve(ctx.carts.newToken());
    const product = await ctx.catalog.create({
      slug: `piece-${randomUUID()}`,
      name: "Pièce",
      price: 12000,
      published: true,
    });
    await ctx.stock.recordIntake(product.id, 5);
    await ctx.carts.add(cart.id, product.id, 1);
    await ctx.carts.applyCode(cart.id, code);
    const opened = await ctx.checkout.start(cart.id);
    await ctx.checkout.setAddress(opened.id, de);
    await ctx.checkout.setVatNumber(opened.id, "DE123456781");
    await choose(ctx, opened.id);

    const orderId = await pay(ctx, opened.id);

    const order = await ctx.orders.getById(orderId);
    expect(order.total).toBe(9000 + 1000);
    const invoice = await ctx.invoices.issueForOrder(orderId);
    expect(invoice.grandTotal).toBe(order.total);
  });

  it("changes nothing for a buyer in the seller's own country", async ({
    expect,
  }) => {
    const ctx = await setup(b2b);
    const id = await aCheckout(ctx, fr);

    await ctx.checkout.setVatNumber(id, "FR123456781");
    const session = await choose(ctx, id);

    expect(session.taxTotal).toBe(1983 + 200);
  });

  it("does nothing while the shop has it off", async ({ expect }) => {
    const ctx = await setup(oss);
    const id = await aCheckout(ctx, de);

    await ctx.checkout.setVatNumber(id, "DE123456781");
    const session = await choose(ctx, id);

    expect(session.taxTotal).toBe(1900 + 192);
  });

  it("refuses a number VIES does not know", async ({ expect }) => {
    const ctx = await setup(b2b);
    const id = await aCheckout(ctx, de);

    await expect(ctx.checkout.setVatNumber(id, "DE000000000")).rejects.toThrow(
      /not a valid VAT number/,
    );
  });

  it("refuses when VIES cannot answer, and keeps the VAT", async ({
    expect,
  }) => {
    const ctx = await setup(b2b);
    const id = await aCheckout(ctx, de);

    await expect(ctx.checkout.setVatNumber(id, "DEDOWN1")).rejects.toThrow(
      /cannot be checked/,
    );
    expect((await ctx.checkout.getById(id)).taxTotal).toBeGreaterThan(0);
  });

  it("drops the exemption when the number is removed", async ({ expect }) => {
    const ctx = await setup(b2b);
    const id = await aCheckout(ctx, de);
    await ctx.checkout.setVatNumber(id, "DE123456781");

    const session = await ctx.checkout.setVatNumber(id, undefined);

    expect(session.vatNumber).toBeUndefined();
    expect(session.taxTotal).toBeGreaterThan(0);
  });
});
