import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { AlephaCommerceInvoicing } from "../invoicing/index.ts";
import { HtmlInvoiceRenderer } from "../invoicing/providers/HtmlInvoiceRenderer.ts";
import { InvoiceService } from "../invoicing/services/InvoiceService.ts";
import { commerceDocumentsEn } from "../lib/documents-en.ts";
import { commerceDocumentsFr } from "../lib/documents-fr.ts";
import { AlephaCommerceNotifications } from "../notifications/index.ts";
import { DefaultOrderMailRenderer } from "../notifications/providers/OrderMailRenderer.ts";
import { orderConfig } from "../orderConfigAtom.ts";
import { AlephaCommerceRecovery } from "../recovery/index.ts";
import { DefaultCartRecoveryMailRenderer } from "../recovery/providers/CartRecoveryMailRenderer.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { CommerceTexts } from "../services/CommerceTexts.ts";
import { OrderService } from "../services/OrderService.ts";
import { StockService } from "../services/StockService.ts";
import { AlephaCommerceShipping } from "../shipping/index.ts";
import { ShippingService } from "../shipping/services/ShippingService.ts";

const setup = async (locale: string) => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaCommerceShipping)
    .with(AlephaCommerceInvoicing)
    .with(AlephaCommerceNotifications)
    .with(AlephaCommerceRecovery);
  const ctx = {
    alepha,
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    checkout: alepha.inject(CheckoutService),
    invoices: alepha.inject(InvoiceService),
    mails: alepha.inject(DefaultOrderMailRenderer),
    orders: alepha.inject(OrderService),
    payments: alepha.inject(PaymentService),
    recoveryMails: alepha.inject(DefaultCartRecoveryMailRenderer),
    renderer: alepha.inject(HtmlInvoiceRenderer),
    shipping: alepha.inject(ShippingService),
    stock: alepha.inject(StockService),
    texts: alepha.inject(CommerceTexts),
  };
  await alepha.start();
  alepha.store.set(orderConfig.key, {
    ...alepha.store.get(orderConfig.key)!,
    locale,
  });

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

const anOrder = async (ctx: Ctx) => {
  const ring = await ctx.catalog.create({
    slug: `ring-${randomUUID()}`,
    name: "Ring",
    price: 8900,
    published: true,
    config: { trackStock: true },
  });
  await ctx.stock.recordIntake(ring.id, 3);
  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  await ctx.carts.add(cart.id, ring.id, 1);
  const opened = await ctx.checkout.start(cart.id);
  await ctx.checkout.setAddress(opened.id, {
    fullName: "Camille Dupont",
    line1: "12 rue des Orfèvres",
    locality: "Paris",
    postalCode: "75001",
    country: "FR",
  });
  const [option] = await ctx.checkout.shippingOptions(opened.id);
  await ctx.checkout.setShippingMethod(opened.id, option!.code);
  const { session, handoff } = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://bijoux.example/merci",
  });
  await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
  return session.orderId!;
};

describe("the dictionaries", () => {
  it("say the same things in French and English", ({ expect }) => {
    expect(Object.keys(commerceDocumentsEn).sort()).toEqual(
      Object.keys(commerceDocumentsFr).sort(),
    );
  });

  it("take the same placeholders in both", ({ expect }) => {
    const slots = (text: string) => text.match(/\$\d/g)?.sort() ?? [];
    for (const [key, text] of Object.entries(commerceDocumentsFr)) {
      expect(slots(commerceDocumentsEn[key]!), key).toEqual(slots(text));
    }
  });
});

describe("CommerceTexts", () => {
  it("falls back on English for a locale nobody supplied", async ({
    expect,
  }) => {
    const ctx = await setup("de");

    expect(ctx.texts.t("invoice.title")).toBe("Invoice");
  });

  it("takes what a value says literally", async ({ expect }) => {
    const ctx = await setup("en");

    expect(ctx.texts.t("reminder.unsubscribe", "$1 $& $2")).toBe(
      "To stop receiving these reminders: $1 $& $2",
    );
  });

  it("takes a dictionary an application adds", async ({ expect }) => {
    const ctx = await setup("de");

    ctx.texts.add("de", { "invoice.title": "Rechnung" });

    expect(ctx.texts.t("invoice.title")).toBe("Rechnung");
    expect(ctx.texts.t("invoice.creditTitle")).toBe("Credit note");
  });
});

describe("an English shop", () => {
  it("issues its invoice in English", async ({ expect }) => {
    const ctx = await setup("en");
    const orderId = await anOrder(ctx);

    const invoice = await ctx.invoices.issueForOrder(orderId);
    const { body } = await ctx.renderer.render(invoice);

    expect(body).toContain('<html lang="en">');
    expect(body).toContain("Invoice");
    expect(body).toContain("Delivery");
    expect(body).toContain("VAT");
    for (const french of ["Facture", "Livraison", "TVA", "Émise"]) {
      expect(body).not.toContain(french);
    }
  });

  it("issues its credit note in English", async ({ expect }) => {
    const ctx = await setup("en");
    const orderId = await anOrder(ctx);
    const invoice = await ctx.invoices.issueForOrder(orderId);
    await ctx.orders.refund(orderId);
    const [refund] = await ctx.orders.refundsOf(orderId);

    const note = await ctx.invoices.creditRefund(refund!.id);
    const { body } = await ctx.renderer.render(note!);

    expect(invoice.id).toBe(note!.creditsInvoiceId);
    expect(note!.note).toBe("Order refund");
    expect(body).toContain("Credit note");
  });

  it("writes its emails in English", async ({ expect }) => {
    const ctx = await setup("en");
    const orderId = await anOrder(ctx);
    const order = await ctx.orders.getById(orderId);

    const confirmation = await ctx.mails.confirmation(
      order,
      await ctx.orders.itemsOf(orderId),
    );
    const shipped = await ctx.mails.shipped(order);
    const reminder = await ctx.recoveryMails.reminder(
      1,
      [{ name: "Ring", quantity: 1 } as any],
      "https://shop.example/out",
    );

    expect(confirmation.subject).toContain("confirmed");
    expect(confirmation.body).toContain("fourteen days");
    expect(shipped.subject).toContain("on its way");
    expect(reminder.subject).toContain("basket");
    expect(reminder.body).toContain("https://shop.example/out");
  });
});

describe("a French shop", () => {
  it("keeps saying what it said", async ({ expect }) => {
    const ctx = await setup("fr");
    const orderId = await anOrder(ctx);

    const invoice = await ctx.invoices.issueForOrder(orderId);
    const { body } = await ctx.renderer.render(invoice);

    expect(body).toContain('<html lang="fr">');
    expect(body).toContain("Facture");
    expect(body).toContain("Livraison (");
    expect(body).toContain("Total TTC");
  });
});
