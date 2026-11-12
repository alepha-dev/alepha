import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { AlephaCommerceInvoicing } from "../invoicing/index.ts";
import { InvoiceService } from "../invoicing/services/InvoiceService.ts";
import { AlephaCommercePromotions } from "../promotions/index.ts";
import { PromotionService } from "../promotions/services/PromotionService.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { StockService } from "../services/StockService.ts";
import { AlephaCommerceShipping } from "../shipping/index.ts";
import { ShippingService } from "../shipping/services/ShippingService.ts";

const setup = async (backend: "postgres" | "sqlite" = "postgres") => {
  const alepha =
    backend === "postgres"
      ? Alepha.create()
          .with(AlephaOrmTestPostgres)
          .with(AlephaCommercePromotions)
          .with(AlephaCommerceShipping)
          .with(AlephaCommerceInvoicing)
      : Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } })
          .with(AlephaCommercePromotions)
          .with(AlephaCommerceShipping)
          .with(AlephaCommerceInvoicing);
  const ctx = {
    alepha,
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    checkout: alepha.inject(CheckoutService),
    dateTime: alepha.inject(DateTimeProvider),
    invoices: alepha.inject(InvoiceService),
    orders: alepha.inject(OrderService),
    payments: alepha.inject(PaymentService),
    promotions: alepha.inject(PromotionService),
    shipping: alepha.inject(ShippingService),
    stock: alepha.inject(StockService),
  };
  await alepha.start();

  // A delivery rate, so `pay()` has something to quote.
  const zone = await ctx.shipping.createZone({
    name: "France",
    countries: ["FR"],
  });
  await ctx.shipping.createRate({
    zoneId: zone.id,
    code: `colissimo-${randomUUID()}`,
    name: "Colissimo",
    price: 690,
  });
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const address = {
  fullName: "Camille Dupont",
  line1: "12 rue des Orfèvres",
  locality: "Paris",
  postalCode: "75001",
  country: "FR",
};

const aProduct = async (ctx: Ctx, price: number, vatRateBps?: number) => {
  const product = await ctx.catalog.create({
    slug: `piece-${randomUUID()}`,
    name: "Bague Aurore",
    price,
    vatRateBps,
    published: true,
    config: { trackStock: true },
  });
  await ctx.stock.recordIntake(product.id, 50);
  return product;
};

const aCart = async (ctx: Ctx, ...productIds: string[]) => {
  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  for (const id of productIds) {
    await ctx.carts.add(cart.id, id, 1);
  }
  return cart;
};

const aCode = () => `CODE${randomUUID().slice(0, 8).toUpperCase()}`;

/**
 * A cart with a delivery address and option, ready to `pay()`.
 */
const reachPay = async (ctx: Ctx, cartId: string, email?: string) => {
  const opened = await ctx.checkout.start(cartId, { email });
  await ctx.checkout.setAddress(opened.id, address);
  const [option] = await ctx.checkout.shippingOptions(opened.id);
  await ctx.checkout.setShippingMethod(opened.id, option!.code);
  return opened.id;
};

const pay = async (ctx: Ctx, sessionId: string) =>
  ctx.checkout.pay(sessionId, { returnUrl: "https://bijoux.example/merci" });

describe("promotions", () => {
  describe("a percentage code", () => {
    it("takes the percentage off every line", async ({ expect }) => {
      const ctx = await setup();
      const a = await aProduct(ctx, 10000);
      const b = await aProduct(ctx, 5000);
      const code = aCode();
      await ctx.promotions.create({
        name: "Dix pour cent",
        code,
        kind: "percent",
        value: 1000,
      });
      const cart = await aCart(ctx, a.id, b.id);

      await ctx.carts.applyCode(cart.id, code);

      const priced = await ctx.carts.price(cart.id);
      expect(priced.itemsTotal).toBe(15000);
      expect(priced.discountTotal).toBe(1500);
      expect(priced.subtotal).toBe(13500);
      expect(priced.lines.map((l) => l.discount)).toEqual([1000, 500]);
      expect(priced.lines.map((l) => l.lineTotal)).toEqual([9000, 4500]);
    });

    it("keeps the VAT exact on a mixed-rate basket, per rate", async ({
      expect,
    }) => {
      const ctx = await setup();
      const standard = await aProduct(ctx, 10000, 2000);
      const reduced = await aProduct(ctx, 10000, 550);
      const code = aCode();
      await ctx.promotions.create({
        name: "Moitié prix",
        code,
        kind: "percent",
        value: 5000,
      });
      const cart = await aCart(ctx, standard.id, reduced.id);
      await ctx.carts.applyCode(cart.id, code);
      const sessionId = await reachPay(ctx, cart.id);

      const session = await ctx.checkout.getById(sessionId);
      // 50 TTC at 20 % holds 8,33; 50 TTC at 5,5 % holds 2,61; delivery at the
      // default rate holds 1,15.
      expect(session.subtotal).toBe(10000);
      expect(session.discountTotal).toBe(10000);
      expect(session.taxTotal).toBe(833 + 261 + 115);
      expect(session.grandTotal).toBe(10690);

      const { session: paying, handoff } = await pay(ctx, sessionId);
      await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
      const order = await ctx.orders.getById(paying.orderId!);
      expect(order.total).toBe(10690);
      expect(order.taxTotal).toBe(1209);

      const invoice = await ctx.invoices.issueForOrder(order.id);
      expect(invoice.grandTotal).toBe(10690);
      expect(invoice.vatTotal).toBe(1209);
    });
  });

  describe("a fixed amount", () => {
    it("is shared across the lines to the cent", async ({ expect }) => {
      const ctx = await setup();
      const a = await aProduct(ctx, 3333);
      const b = await aProduct(ctx, 3333);
      const c = await aProduct(ctx, 3334);
      const code = aCode();
      await ctx.promotions.create({
        name: "Dix euros",
        code,
        kind: "amount",
        value: 1000,
      });
      const cart = await aCart(ctx, a.id, b.id, c.id);

      await ctx.carts.applyCode(cart.id, code);

      const priced = await ctx.carts.price(cart.id);
      expect(priced.lines.reduce((sum, l) => sum + l.discount, 0)).toBe(1000);
      expect(priced.subtotal).toBe(9000);
    });

    it("never takes the basket below zero", async ({ expect }) => {
      const ctx = await setup();
      const a = await aProduct(ctx, 800);
      const code = aCode();
      await ctx.promotions.create({
        name: "Dix euros",
        code,
        kind: "amount",
        value: 1000,
      });
      const cart = await aCart(ctx, a.id);

      await ctx.carts.applyCode(cart.id, code);

      const priced = await ctx.carts.price(cart.id);
      expect(priced.discountTotal).toBe(800);
      expect(priced.subtotal).toBe(0);
    });
  });

  describe("a free-delivery code", () => {
    it("charges no delivery and touches no line", async ({ expect }) => {
      const ctx = await setup();
      const a = await aProduct(ctx, 5000);
      const code = aCode();
      await ctx.promotions.create({
        name: "Livraison offerte",
        code,
        kind: "freeShipping",
      });
      const cart = await aCart(ctx, a.id);
      await ctx.carts.applyCode(cart.id, code);

      const sessionId = await reachPay(ctx, cart.id);
      const { session } = await pay(ctx, sessionId);

      expect(session.shippingTotal).toBe(0);
      expect(session.grandTotal).toBe(5000);
      const order = await ctx.orders.getById(session.orderId!);
      expect(order.total).toBe(5000);
      expect(order.promotionCode).toBe(code);
    });
  });

  describe("an automatic promotion", () => {
    it("applies with no code, and the best one wins", async ({ expect }) => {
      const ctx = await setup();
      const a = await aProduct(ctx, 10000);
      await ctx.promotions.create({
        name: "Cinq pour cent",
        kind: "percent",
        value: 500,
      });
      await ctx.promotions.create({
        name: "Quinze pour cent",
        kind: "percent",
        value: 1500,
      });
      const cart = await aCart(ctx, a.id);

      const priced = await ctx.carts.price(cart.id);

      expect(priced.discountTotal).toBe(1500);
      expect(priced.discountLabel).toBe("Quinze pour cent");
    });
  });

  describe("refusals", () => {
    it("refuses a code nobody issued", async ({ expect }) => {
      const ctx = await setup();
      const a = await aProduct(ctx, 5000);
      const cart = await aCart(ctx, a.id);

      await expect(ctx.carts.applyCode(cart.id, "NOPE")).rejects.toThrow(
        /'NOPE' is not a valid code/,
      );
    });

    it("refuses a code under its minimum order", async ({ expect }) => {
      const ctx = await setup();
      const a = await aProduct(ctx, 5000);
      const code = aCode();
      await ctx.promotions.create({
        name: "Dès cent euros",
        code,
        kind: "percent",
        value: 1000,
        minSubtotal: 10000,
      });
      const cart = await aCart(ctx, a.id);

      await expect(ctx.carts.applyCode(cart.id, code)).rejects.toThrow(
        /minimum/,
      );
    });

    it("refuses a code outside its dates", async ({ expect }) => {
      const ctx = await setup();
      const a = await aProduct(ctx, 5000);
      const past = aCode();
      const future = aCode();
      await ctx.promotions.create({
        name: "Passé",
        code: past,
        kind: "percent",
        value: 1000,
        endsAt: "2020-01-01T00:00:00.000Z",
      });
      await ctx.promotions.create({
        name: "Futur",
        code: future,
        kind: "percent",
        value: 1000,
        startsAt: "2999-01-01T00:00:00.000Z",
      });
      const cart = await aCart(ctx, a.id);

      await expect(ctx.carts.applyCode(cart.id, past)).rejects.toThrow(
        /no longer valid/,
      );
      await expect(ctx.carts.applyCode(cart.id, future)).rejects.toThrow(
        /not valid yet/,
      );
    });

    it("refuses a code switched off", async ({ expect }) => {
      const ctx = await setup();
      const a = await aProduct(ctx, 5000);
      const code = aCode();
      await ctx.promotions.create({
        name: "Off",
        code,
        kind: "percent",
        value: 1000,
        active: false,
      });
      const cart = await aCart(ctx, a.id);

      await expect(ctx.carts.applyCode(cart.id, code)).rejects.toThrow(
        /no longer valid/,
      );
    });

    it("refuses to pay when a code lapsed after it was applied", async ({
      expect,
    }) => {
      const ctx = await setup();
      const a = await aProduct(ctx, 5000);
      const code = aCode();
      const promotion = await ctx.promotions.create({
        name: "Dix pour cent",
        code,
        kind: "percent",
        value: 1000,
      });
      const cart = await aCart(ctx, a.id);
      await ctx.carts.applyCode(cart.id, code);
      const sessionId = await reachPay(ctx, cart.id);

      await ctx.promotions.update(promotion.id, { active: false });

      await expect(pay(ctx, sessionId)).rejects.toThrow(/no longer valid/);
    });
  });

  describe("usage limits", () => {
    it("stops a code at its total limit", async ({ expect }) => {
      const ctx = await setup();
      const a = await aProduct(ctx, 5000);
      const code = aCode();
      await ctx.promotions.create({
        name: "Une fois",
        code,
        kind: "percent",
        value: 1000,
        usageLimit: 1,
      });

      const first = await aCart(ctx, a.id);
      await ctx.carts.applyCode(first.id, code);
      await pay(ctx, await reachPay(ctx, first.id));

      const second = await aCart(ctx, a.id);
      await expect(ctx.carts.applyCode(second.id, code)).rejects.toThrow(
        /used up/,
      );
    });

    it("stops a code at its limit per customer, by email for a guest", async ({
      expect,
    }) => {
      const ctx = await setup();
      const a = await aProduct(ctx, 5000);
      const code = aCode();
      await ctx.promotions.create({
        name: "Une par client",
        code,
        kind: "percent",
        value: 1000,
        usagePerCustomer: 1,
      });

      const first = await aCart(ctx, a.id);
      await ctx.carts.applyCode(first.id, code);
      await pay(ctx, await reachPay(ctx, first.id, "camille@example.com"));

      const second = await aCart(ctx, a.id);
      await ctx.carts.applyCode(second.id, code);
      const sessionId = await reachPay(ctx, second.id, "camille@example.com");

      await expect(pay(ctx, sessionId)).rejects.toThrow(/already used/);
      // The refused checkout left nothing behind: the buyer can still pay it
      // without the code.
      expect((await ctx.checkout.getById(sessionId)).status).toBe("open");
    });

    it("gives the use back when the order is cancelled", async ({ expect }) => {
      const ctx = await setup();
      const a = await aProduct(ctx, 5000);
      const code = aCode();
      await ctx.promotions.create({
        name: "Une fois",
        code,
        kind: "percent",
        value: 1000,
        usageLimit: 1,
      });
      const first = await aCart(ctx, a.id);
      await ctx.carts.applyCode(first.id, code);
      const { session } = await pay(ctx, await reachPay(ctx, first.id));

      await ctx.orders.cancel(session.orderId!);

      const second = await aCart(ctx, a.id);
      await ctx.carts.applyCode(second.id, code);
      expect((await ctx.carts.price(second.id)).discountTotal).toBe(500);
    });

    describe.each(["postgres", "sqlite"] as const)("on %s", (backend) => {
      it("lets exactly the limit through under concurrency", async ({
        expect,
      }) => {
        const ctx = await setup(backend);
        const a = await aProduct(ctx, 5000);
        const code = aCode();
        await ctx.promotions.create({
          name: "Deux fois",
          code,
          kind: "percent",
          value: 1000,
          usageLimit: 2,
        });

        const sessions: string[] = [];
        for (let i = 0; i < 6; i++) {
          const cart = await aCart(ctx, a.id);
          await ctx.carts.applyCode(cart.id, code);
          sessions.push(await reachPay(ctx, cart.id));
        }

        const outcomes = await Promise.allSettled(
          sessions.map((id) => pay(ctx, id)),
        );

        expect(outcomes.filter((it) => it.status === "fulfilled")).toHaveLength(
          2,
        );
      });
    });
  });

  describe("what is frozen", () => {
    it("keeps the discount on the order and the invoice whatever the promotion becomes", async ({
      expect,
    }) => {
      const ctx = await setup();
      const a = await aProduct(ctx, 10000);
      const code = aCode();
      const promotion = await ctx.promotions.create({
        name: "Dix pour cent",
        code,
        kind: "percent",
        value: 1000,
      });
      const cart = await aCart(ctx, a.id);
      await ctx.carts.applyCode(cart.id, code);
      const { session, handoff } = await pay(ctx, await reachPay(ctx, cart.id));
      await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

      await ctx.promotions.update(promotion.id, { value: 5000 });

      const order = await ctx.orders.getById(session.orderId!);
      expect(order.discountTotal).toBe(1000);
      expect(order.promotionCode).toBe(code);
      const [item] = await ctx.orders.itemsOf(order.id);
      expect(item!.discount).toBe(1000);

      const invoice = await ctx.invoices.issueForOrder(order.id);
      const [line] = invoice.lines;
      expect(line!.unitPrice).toBe(10000);
      expect(line!.discount).toBe(1000);
      expect(line!.lineTotal).toBe(9000);
      expect(invoice.grandTotal).toBe(9690);
    });

    it("credits what was paid, not the list price", async ({ expect }) => {
      const ctx = await setup();
      const a = await aProduct(ctx, 10000);
      const code = aCode();
      await ctx.promotions.create({
        name: "Dix pour cent",
        code,
        kind: "percent",
        value: 1000,
      });
      const cart = await aCart(ctx, a.id);
      await ctx.carts.applyCode(cart.id, code);
      const { session, handoff } = await pay(ctx, await reachPay(ctx, cart.id));
      await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
      const invoice = await ctx.invoices.issueForOrder(session.orderId!);

      const note = await ctx.invoices.creditNote(invoice.id);

      expect(note.grandTotal).toBe(-invoice.grandTotal);
    });

    it("clears the code off the cart once the order is paid", async ({
      expect,
    }) => {
      const ctx = await setup();
      const a = await aProduct(ctx, 5000);
      const code = aCode();
      await ctx.promotions.create({
        name: "Dix pour cent",
        code,
        kind: "percent",
        value: 1000,
      });
      const cart = await aCart(ctx, a.id);
      await ctx.carts.applyCode(cart.id, code);
      const { handoff } = await pay(ctx, await reachPay(ctx, cart.id));

      await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

      const after = await ctx.carts.price(cart.id);
      expect(after.promotionCode).toBeUndefined();
    });
  });
});
