import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";
import { CartService } from "../cart/services/CartService.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { AlephaCommerceInvoicing } from "../invoicing/index.ts";
import { HtmlInvoiceRenderer } from "../invoicing/providers/HtmlInvoiceRenderer.ts";
import { InvoiceRenderer } from "../invoicing/providers/InvoiceRenderer.ts";
import { sellerIdentityAtom } from "../invoicing/sellerIdentityAtom.ts";
import { InvoiceService } from "../invoicing/services/InvoiceService.ts";
import { VatCalculator } from "../invoicing/services/VatCalculator.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { StockService } from "../services/StockService.ts";

const seller = {
  name: "Atelier Aurore",
  address: "12 rue des Orfèvres, 75001 Paris",
  registrationNumber: "912 345 678 00012",
  legalForm: "SASU",
  vatNumber: "FR91234567800",
  numberPrefix: "FA",
};

const setup = async (
  identity: Partial<typeof seller> & { vatExemptionNotice?: string } = {},
) => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaCommerceInvoicing);

  alepha.store.set(sellerIdentityAtom.key, { ...seller, ...identity } as any);

  const ctx = {
    alepha,
    catalog: alepha.inject(CatalogService),
    carts: alepha.inject(CartService),
    checkout: alepha.inject(CheckoutService),
    orders: alepha.inject(OrderService),
    stock: alepha.inject(StockService),
    payments: alepha.inject(PaymentService),
    invoices: alepha.inject(InvoiceService),
    renderer: alepha.inject(InvoiceRenderer),
    vat: alepha.inject(VatCalculator),
  };
  await alepha.start();
  return ctx;
};

const aRing = (catalog: CatalogService, price = 8900) =>
  catalog.create({
    slug: `ring-${randomUUID()}`,
    name: "Bague Aurore",
    price,
    published: true,
    config: { trackStock: true },
  });

/** Sell one unit of a product, end to end, and return the paid order id. */
const sell = async (
  ctx: Awaited<ReturnType<typeof setup>>,
  productId: string,
  quantity = 1,
) => {
  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  await ctx.carts.add(cart.id, productId, quantity);
  const opened = await ctx.checkout.start(cart.id);
  const { session, handoff } = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://bijoux.example/merci",
  });
  await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
  return session.orderId!;
};

describe("VAT arithmetic", () => {
  it("never drifts: base plus tax equals the inclusive amount", async ({
    expect,
  }) => {
    const { vat } = await setup();

    // Every amount from 1 cent to 10 € at three rates. A single rounding
    // mistake shows up here and nowhere else.
    for (const rateBps of [2000, 1000, 550, 210]) {
      for (let ttc = 1; ttc <= 1000; ttc++) {
        const { baseCents, vatCents } = vat.fromInclusive(ttc, rateBps);
        expect(baseCents + vatCents).toBe(ttc);
      }
    }
  });

  it("groups lines by rate before rounding, not after", async ({ expect }) => {
    const { vat } = await setup();

    // Three lines at the same rate must round once, as a single line of the
    // summed amount would.
    const grouped = vat.ventilate([
      { ttcCents: 333, rateBps: 2000 },
      { ttcCents: 333, rateBps: 2000 },
      { ttcCents: 333, rateBps: 2000 },
    ]);
    const single = vat.fromInclusive(999, 2000);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.baseCents).toBe(single.baseCents);
    expect(grouped[0]!.vatCents).toBe(single.vatCents);
  });

  it("keeps one bucket per rate, sorted", async ({ expect }) => {
    const { vat } = await setup();
    const buckets = vat.ventilate([
      { ttcCents: 2000, rateBps: 2000 },
      { ttcCents: 1000, rateBps: 550 },
      { ttcCents: 500, rateBps: 2000 },
    ]);

    expect(buckets.map((b) => b.rateBps)).toEqual([550, 2000]);
    expect(vat.totals(buckets).ttcCents).toBe(3500);
  });

  it("treats a zero rate as fully untaxed", async ({ expect }) => {
    const { vat } = await setup();
    expect(vat.fromInclusive(8900, 0)).toEqual({
      baseCents: 8900,
      vatCents: 0,
    });
  });
});

describe("invoice issuing", () => {
  it("issues automatically when an order is paid", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);

    const orderId = await sell(ctx, ring.id);
    const issued = await ctx.invoices.listForOrder(orderId);

    expect(issued).toHaveLength(1);
    expect(issued[0]!.number).toMatch(/^FA-\d{4}-000001$/);
    expect(issued[0]!.grandTotal).toBe(8900);
    // 89,00 € inclusive of 20 % → 74,17 € base + 14,83 € tax.
    expect(issued[0]!.baseTotal).toBe(7417);
    expect(issued[0]!.vatTotal).toBe(1483);
    expect(issued[0]!.baseTotal + issued[0]!.vatTotal).toBe(8900);
  });

  it("numbers without gaps, in order", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 5);

    const numbers: string[] = [];
    for (let i = 0; i < 4; i++) {
      const orderId = await sell(ctx, ring.id);
      const [invoice] = await ctx.invoices.listForOrder(orderId);
      numbers.push(invoice!.number);
    }

    const year = new Date().getFullYear();
    expect(numbers).toEqual([
      `FA-${year}-000001`,
      `FA-${year}-000002`,
      `FA-${year}-000003`,
      `FA-${year}-000004`,
    ]);
  });

  it("does not issue twice for a redelivered webhook", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);

    const cart = await ctx.carts.resolve(ctx.carts.newToken());
    await ctx.carts.add(cart.id, ring.id, 1);
    const opened = await ctx.checkout.start(cart.id);
    const { session, handoff } = await ctx.checkout.pay(opened.id, {
      returnUrl: "https://bijoux.example/merci",
    });

    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");
    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

    expect(await ctx.invoices.listForOrder(session.orderId!)).toHaveLength(1);
  });

  it("bills delivery as its own line", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);

    // No shipping module here, so bill an order created directly with a charge.
    const order = await ctx.orders.create({
      status: "paid",
      lines: [{ productId: ring.id, quantity: 1 }],
      shippingTotal: 690,
      shippingMethod: "colissimo",
    });

    const invoice = await ctx.invoices.issueForOrder(order.id);
    const lines = invoice.lines as any[];

    expect(lines).toHaveLength(2);
    expect(lines[1].description).toContain("Livraison");
    expect(lines[1].lineTotal).toBe(690);
    expect(invoice.grandTotal).toBe(9590);
  });

  // The invoice/order total mismatch guard in `issueForOrder` is unreachable
  // through the public API — `OrderService.create` derives `total` from the same
  // lines the invoice bills — so there is no honest test for it. It stays as
  // defence in depth against a future caller that sets totals by hand.

  it("refuses to invoice an unpaid order", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);

    const order = await ctx.orders.create({
      status: "pending",
      lines: [{ productId: ring.id, quantity: 1 }],
    });

    await expect(ctx.invoices.issueForOrder(order.id)).rejects.toThrow(
      /it is 'pending'/,
    );
  });

  it("prints the exemption notice and no tax when not liable", async ({
    expect,
  }) => {
    const ctx = await setup({
      vatNumber: undefined,
      vatExemptionNotice: "TVA non applicable, art. 293 B du CGI",
    });
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);

    const orderId = await sell(ctx, ring.id);
    const [invoice] = await ctx.invoices.listForOrder(orderId);

    expect(invoice!.vatTotal).toBe(0);
    expect(invoice!.baseTotal).toBe(8900);

    const rendered = await ctx.renderer.render(invoice!);
    expect(rendered.body).toContain("art. 293 B du CGI");
    // No tax column when there is no tax.
    expect(rendered.body).not.toContain("Total HT");
  });
});

describe("credit notes", () => {
  it("issues one on refund, taking the next number", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);

    const orderId = await sell(ctx, ring.id);
    await ctx.orders.refund(orderId);

    const issued = await ctx.invoices.listForOrder(orderId);
    expect(issued).toHaveLength(2);

    const [original, credit] = issued;
    const year = new Date().getFullYear();
    expect(original!.number).toBe(`FA-${year}-000001`);
    // The next number in the same series — not a reuse of the original's.
    expect(credit!.number).toBe(`FA-${year}-000002`);
    expect(credit!.creditsInvoiceId).toBe(original!.id);
    expect(credit!.grandTotal).toBe(-original!.grandTotal);
    expect(credit!.vatTotal).toBe(-original!.vatTotal);
    expect(credit!.note).toBeTruthy();
  });

  it("does not credit twice for a redelivered refund", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);

    const orderId = await sell(ctx, ring.id);
    await ctx.orders.refund(orderId);
    await ctx.orders.refund(orderId);
    await ctx.orders.refund(orderId);

    expect(await ctx.invoices.listForOrder(orderId)).toHaveLength(2);
  });
});

describe("invoice rendering", () => {
  it("prints every mention a French B2C invoice needs", async ({ expect }) => {
    const ctx = await setup();
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);

    const orderId = await sell(ctx, ring.id);
    const [invoice] = await ctx.invoices.listForOrder(orderId);
    const rendered = await ctx.renderer.render(invoice!);
    const html = String(rendered.body);

    // Seller identity.
    expect(html).toContain("Atelier Aurore");
    expect(html).toContain("912 345 678 00012");
    expect(html).toContain("FR91234567800");
    expect(html).toContain("SASU");
    // Invoice identity.
    expect(html).toContain(invoice!.number);
    // Tax breakdown, and the retraction notice.
    expect(html).toContain("Total HT");
    expect(html).toContain("TVA 20 %");
    expect(html).toContain("rétractation");
    expect(rendered.contentType).toContain("text/html");
    expect(rendered.filename).toBe(`${invoice!.number}.html`);
  });

  it("escapes what a customer typed", async ({ expect }) => {
    const ctx = await setup({ name: 'Aurore <script>alert("x")</script>' });
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 2);

    const orderId = await sell(ctx, ring.id);
    const [invoice] = await ctx.invoices.listForOrder(orderId);
    const html = String((await ctx.renderer.render(invoice!)).body);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("lets a consumer swap in a PDF renderer", async ({ expect }) => {
    class FakePdfRenderer extends HtmlInvoiceRenderer {
      override async render(invoice: any) {
        const html = await super.render(invoice);
        return {
          contentType: "application/pdf",
          filename: `${invoice.number}.pdf`,
          body: html.body,
        };
      }
    }

    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with({ provide: InvoiceRenderer, use: FakePdfRenderer })
      .with(AlephaCommerceInvoicing);
    alepha.store.set(sellerIdentityAtom.key, seller as any);
    const renderer = alepha.inject(InvoiceRenderer);
    await alepha.start();

    expect(renderer).toBeInstanceOf(FakePdfRenderer);
  });
});
