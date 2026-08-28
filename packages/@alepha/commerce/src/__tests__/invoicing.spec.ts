import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { type DateTime, DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { AlephaCommerceInvoicing } from "../invoicing/index.ts";
import { HtmlInvoiceRenderer } from "../invoicing/providers/HtmlInvoiceRenderer.ts";
import { InvoiceRenderer } from "../invoicing/providers/InvoiceRenderer.ts";
import { sellerIdentityAtom } from "../invoicing/sellerIdentityAtom.ts";
import { InvoiceService } from "../invoicing/services/InvoiceService.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { StockService } from "../services/StockService.ts";
import { VatCalculator } from "../services/VatCalculator.ts";
import { AlephaCommerceSettlement } from "../settlement/index.ts";

const seller = {
  name: "Atelier Aurore",
  address: "12 rue des Orfèvres, 75001 Paris",
  registrationNumber: "912 345 678 00012",
  legalForm: "SASU",
  vatNumber: "FR91234567800",
  numberPrefix: "FA",
};

/**
 * A clock that runs normally until pinned.
 *
 * Freezing the whole container is not an option here: issuance rides the
 * settlement workflow, whose scheduling reads the same provider. So the test
 * lets the workflow run on the real clock and pins only the instant the credit
 * note is issued in - which is the call under test.
 */
class PinnableClock extends DateTimeProvider {
  public pinned?: string;

  public override now(): DateTime {
    return this.pinned ? this.of(this.pinned) : super.now();
  }
}

const setup = async (
  identity: Partial<typeof seller> & { vatExemptionNotice?: string } = {},
) => {
  // Settlement drives the paid-side invoice since the paid-path moved
  // onto the workflow; invoicing alone covers only credit notes.
  const alepha = Alepha.create()
    .with({ provide: DateTimeProvider, use: PinnableClock })
    .with(AlephaOrmPostgres)
    .with(AlephaCommerceInvoicing)
    .with(AlephaCommerceSettlement);

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
    clock: alepha.inject(DateTimeProvider) as PinnableClock,
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

/**
 * Sell one unit of a product, end to end, and return the paid order id.
 * Waits for the settlement workflow to issue the invoice — issuance is a
 * workflow step now, landing a beat after the webhook returns.
 */
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
  const orderId = session.orderId!;

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const issued = await ctx.invoices.listForOrder(orderId);
    if (issued.length > 0) return orderId;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`invoice for order ${orderId} never issued`);
};

/**
 * Poll until the settlement workflow has issued the order's invoice.
 */
const invoiceFor = async (
  ctx: Awaited<ReturnType<typeof setup>>,
  orderId: string,
) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const issued = await ctx.invoices.listForOrder(orderId);
    if (issued.length > 0) return issued;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`invoice for order ${orderId} never issued`);
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

  it("apportions across tenders without losing a cent", async ({ expect }) => {
    const { vat } = await setup();

    // 10,00 € at 5,5 % beside 20,00 € at 20 %, settled in three equal tenders —
    // amounts that divide evenly at neither rate.
    const buckets = vat.ventilate([
      { ttcCents: 1000, rateBps: 550 },
      { ttcCents: 2000, rateBps: 2000 },
    ]);
    const legs = vat.apportion(buckets, [1000, 1000, 1000]);

    expect(legs).toHaveLength(3);
    // Re-merging the legs must reproduce the sale exactly: a closure aggregates
    // legs, so drift here is drift in the day's declared VAT.
    expect(vat.merge(legs)).toEqual(buckets);
  });

  it("apportions to empty groups when there is nothing to settle", async ({
    expect,
  }) => {
    const { vat } = await setup();
    const buckets = vat.ventilate([{ ttcCents: 1000, rateBps: 2000 }]);

    expect(vat.apportion(buckets, [0, 0])).toEqual([[], []]);
    expect(vat.apportion(buckets, [])).toEqual([]);
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

  /**
   * A catalog is routinely mixed-rate — a book at 5.5 % beside a good at 20 %.
   * The rate used to come from `TaxService.rateBps()`, which takes no argument,
   * so every line billed at the seller's default and the invoice carried a
   * single bucket that disagreed with what had been sold. The per-rate
   * breakdown this module exists to produce could never have more than one line.
   */
  it("bills each line at its own rate, and shows one bucket per rate", async ({
    expect,
  }) => {
    const ctx = await setup();

    // 20,00 € at the standard rate, 10,00 € at the reduced one.
    const good = await ctx.catalog.create({
      slug: `good-${randomUUID()}`,
      name: "Écrin",
      price: 2000,
      published: true,
    });
    const book = await ctx.catalog.create({
      slug: `book-${randomUUID()}`,
      name: "Catalogue",
      price: 1000,
      vatRateBps: 550,
      published: true,
    });

    await ctx.stock.recordIntake(good.id, 1);
    await ctx.stock.recordIntake(book.id, 1);

    const cart = await ctx.carts.resolve(ctx.carts.newToken());
    await ctx.carts.add(cart.id, good.id, 1);
    await ctx.carts.add(cart.id, book.id, 1);
    const opened = await ctx.checkout.start(cart.id);
    const { session, handoff } = await ctx.checkout.pay(opened.id, {
      returnUrl: "https://bijoux.example/merci",
    });
    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

    const [invoice] = await invoiceFor(ctx, session.orderId!);

    expect(invoice!.vatBuckets.map((b) => b.rateBps)).toEqual([550, 2000]);

    const reduced = invoice!.vatBuckets.find((b) => b.rateBps === 550)!;
    const standard = invoice!.vatBuckets.find((b) => b.rateBps === 2000)!;
    // 10,00 € inclusive of 5,5 % → 9,48 € base + 0,52 € tax.
    expect(reduced.baseCents + reduced.vatCents).toBe(1000);
    expect(reduced.vatCents).toBe(52);
    // 20,00 € inclusive of 20 % → 16,67 € base + 3,33 € tax.
    expect(standard.baseCents + standard.vatCents).toBe(2000);
    expect(standard.vatCents).toBe(333);

    expect(invoice!.grandTotal).toBe(3000);
    expect(invoice!.vatTotal).toBe(385);
  });

  it("snapshots the rate, so editing the catalog cannot rewrite an invoice", async ({
    expect,
  }) => {
    const ctx = await setup();
    const book = await ctx.catalog.create({
      slug: `book-${randomUUID()}`,
      name: "Catalogue",
      price: 1000,
      vatRateBps: 550,
      published: true,
    });
    await ctx.stock.recordIntake(book.id, 1);

    const orderId = await sell(ctx, book.id);

    // The catalog is corrected afterwards. A document already issued has to
    // keep the rate it was actually computed with.
    await ctx.catalog.update(book.id, { vatRateBps: 2000 });

    const [invoice] = await ctx.invoices.listForOrder(orderId);
    expect(invoice!.vatBuckets.map((b) => b.rateBps)).toEqual([550]);
    expect(invoice!.vatTotal).toBe(52);
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

    await invoiceFor(ctx, session.orderId!);
    // Give a would-be duplicate a beat to land before asserting it didn't.
    await new Promise((r) => setTimeout(r, 200));
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

// ---------------------------------------------------------------------------

describe("invoice dating", () => {
  it("dates and numbers in the seller's timezone, not UTC", async ({
    expect,
  }) => {
    const ctx = await setup({ timezone: "Europe/Paris" } as never);
    const ring = await aRing(ctx.catalog);
    await ctx.stock.recordIntake(ring.id, 1);
    const orderId = await sell(ctx, ring.id);
    const [invoice] = await invoiceFor(ctx, orderId);

    // 23:30 UTC on New Year's Eve is already 00:30 on 1 January in Paris.
    // Derived from UTC, the credit note was dated 31 December and took a
    // number in the closing year's series - a gap in one, a stranger in the
    // other, which is exactly what an audit asks about.
    ctx.clock.pinned = "2026-12-31T23:30:00Z";
    const credit = await ctx.invoices.creditNote(invoice.id, {
      reason: "New Year's Eve",
    });
    ctx.clock.pinned = undefined;

    expect(credit.year).toBe(2027);
    expect(credit.number).toContain("-2027-");
    expect(credit.issuedAt.slice(0, 10)).toBe("2027-01-01");

    // Still an unambiguous instant, not a naive local time.
    expect(new Date(credit.issuedAt).toISOString()).toBe(
      "2026-12-31T23:30:00.000Z",
    );

    await ctx.alepha.stop();
  });
});
