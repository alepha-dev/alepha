import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import { AdminOrderController } from "../admin/controllers/AdminOrderController.ts";
import { AlephaCommerceAdmin } from "../admin/index.ts";
import { CartService } from "../cart/services/CartService.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { AlephaCommerceInvoicing } from "../invoicing/index.ts";
import { InvoiceService } from "../invoicing/services/InvoiceService.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { OrderService } from "../services/OrderService.ts";
import { StockService } from "../services/StockService.ts";
import { AlephaCommerceSettlement } from "../settlement/index.ts";

const admin = { id: randomUUID(), roles: ["admin"] };

const setup = async (invoiceService = InvoiceService) => {
  const alepha = Alepha.create();
  if (invoiceService !== InvoiceService) {
    alepha.with({ provide: InvoiceService, use: invoiceService });
  }
  alepha
    .with(AlephaOrmTestPostgres)
    .with(AlephaCommerceInvoicing)
    .with(AlephaCommerceSettlement)
    .with(AlephaCommerceAdmin);
  const ctx = {
    alepha,
    adminOrders: alepha.inject(AdminOrderController),
    carts: alepha.inject(CartService),
    catalog: alepha.inject(CatalogService),
    checkout: alepha.inject(CheckoutService),
    invoices: alepha.inject(InvoiceService),
    orders: alepha.inject(OrderService),
    payments: alepha.inject(PaymentService),
    stock: alepha.inject(StockService),
  };
  await alepha.start();
  return ctx;
};

type Ctx = Awaited<ReturnType<typeof setup>>;

/**
 * A paid order of two products at two rates.
 */
const buy = async (ctx: Ctx) => {
  const make = async (price: number, vatRateBps: number) => {
    const product = await ctx.catalog.create({
      slug: `piece-${randomUUID()}`,
      name: `Pièce ${vatRateBps}`,
      price,
      vatRateBps,
      published: true,
    });
    await ctx.stock.recordIntake(product.id, 10);
    return product;
  };
  const standard = await make(12000, 2000);
  const reduced = await make(5275, 550);

  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  await ctx.carts.add(cart.id, standard.id, 2);
  await ctx.carts.add(cart.id, reduced.id, 1);
  const opened = await ctx.checkout.start(cart.id);
  const { session, handoff } = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://bijoux.example/merci",
  });
  await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

  const orderId = session.orderId!;
  const invoice = await ctx.invoices.issueForOrder(orderId);
  return { orderId, intentId: handoff.intentId, invoice };
};

/**
 * The credit note job runs on its own: wait for the notes it should write.
 */
const creditNotes = async (ctx: Ctx, orderId: string, count: number) => {
  for (let attempt = 0; attempt < 300; attempt++) {
    const notes = (await ctx.invoices.listForOrder(orderId)).filter(
      (it) => it.creditsInvoiceId,
    );
    if (notes.length >= count) {
      return notes;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No ${count} credit note(s) for order ${orderId}`);
};

describe("InvoiceService.creditNote", () => {
  it("credits an amount exactly, shared across the rates", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { invoice } = await buy(ctx);

    const note = await ctx.invoices.creditNote(invoice.id, {
      amount: 2930,
      reason: "Geste commercial",
    });

    expect(note.grandTotal).toBe(-2930);
    expect(note.baseTotal + note.vatTotal).toBe(-2930);
    expect(note.note).toBe("Geste commercial");
    expect(note.vatBuckets.map((it) => it.rateBps)).toEqual([550, 2000]);
    expect(
      note.vatBuckets.reduce((sum, b) => sum + b.baseCents + b.vatCents, 0),
    ).toBe(-2930);
  });

  it("credits lines at their own rate, and only those", async ({ expect }) => {
    const ctx = await setup();
    const { orderId, invoice } = await buy(ctx);
    const items = await ctx.orders.itemsOf(orderId);
    const reduced = items.find((it) => it.rateBps === 550)!;

    const note = await ctx.invoices.creditNote(invoice.id, {
      lines: [{ orderItemId: reduced.id, quantity: 1 }],
    });

    expect(note.grandTotal).toBe(-5275);
    expect(note.vatBuckets).toEqual([
      { rateBps: 550, baseCents: -5000, vatCents: -275 },
    ]);
  });

  it("closes the invoice to the cent, however the refund was cut up", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { invoice } = await buy(ctx);

    await ctx.invoices.creditNote(invoice.id, { amount: 3333 });
    await ctx.invoices.creditNote(invoice.id, { amount: 1 });
    await ctx.invoices.creditNote(invoice.id);

    const notes = await ctx.invoices.listForOrder(invoice.orderId);
    const sum = (read: (it: (typeof notes)[number]) => number) =>
      notes.reduce((total, it) => total + read(it), 0);
    expect(sum((it) => it.grandTotal)).toBe(0);
    expect(sum((it) => it.vatTotal)).toBe(0);
    expect(sum((it) => it.baseTotal)).toBe(0);
  });

  it("refuses to credit more than the invoice has left", async ({ expect }) => {
    const ctx = await setup();
    const { invoice } = await buy(ctx);
    await ctx.invoices.creditNote(invoice.id, { amount: 1000 });

    await expect(
      ctx.invoices.creditNote(invoice.id, { amount: invoice.grandTotal }),
    ).rejects.toThrow(/is left/);
  });

  it("refuses a second full credit", async ({ expect }) => {
    const ctx = await setup();
    const { invoice } = await buy(ctx);
    await ctx.invoices.creditNote(invoice.id);

    await expect(ctx.invoices.creditNote(invoice.id)).rejects.toThrow(
      /is left/,
    );
  });
});

describe("a refund's credit note", () => {
  it("answers a partial refund made on the rail, for its amount", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { orderId, intentId } = await buy(ctx);

    await ctx.payments.refund(intentId, 890);

    const [note] = await creditNotes(ctx, orderId, 1);
    expect(note!.grandTotal).toBe(-890);
  });

  it(
    "survives a failure: the job retries it",
    { timeout: 20_000 },
    async ({ expect }) => {
      class FlakyInvoiceService extends InvoiceService {
        public failures = 0;
        public override async creditRefund(refundId: string) {
          if (this.failures < 1) {
            this.failures++;
            throw new Error("the credit note store is down (test)");
          }
          return super.creditRefund(refundId);
        }
      }
      const ctx = await setup(FlakyInvoiceService);
      const { orderId, intentId } = await buy(ctx);

      await ctx.payments.refund(intentId, 890);

      const [note] = await creditNotes(ctx, orderId, 1);
      expect(note!.grandTotal).toBe(-890);
    },
  );

  it("is issued once for a redelivered refund", async ({ expect }) => {
    const ctx = await setup();
    const { orderId, intentId } = await buy(ctx);

    await ctx.payments.refund(intentId, 890);
    await ctx.orders.refund(orderId, { refundedTotal: 890 });
    const [refund] = await ctx.orders.refundsOf(orderId);
    await ctx.invoices.creditRefund(refund!.id);

    await creditNotes(ctx, orderId, 1);
    expect(
      (await ctx.invoices.listForOrder(orderId)).filter(
        (it) => it.creditsInvoiceId,
      ),
    ).toHaveLength(1);
  });
});

describe("the admin refund", () => {
  it("refunds an amount, with a reason", async ({ expect }) => {
    const ctx = await setup();
    const { orderId, intentId } = await buy(ctx);

    const { data } = await ctx.adminOrders.commerceAdminOrderRefund.fetch(
      {
        params: { id: orderId },
        body: { amount: 1500, reason: "Colis abîmé" },
      },
      { user: admin },
    );

    expect(data.status).toBe("partially_refunded");
    expect(data.refundedTotal).toBe(1500);
    expect((await ctx.payments.getIntent(intentId)).status).toBe(
      "partially_refunded",
    );

    const [note] = await creditNotes(ctx, orderId, 1);
    expect(note!.grandTotal).toBe(-1500);
    expect(note!.note).toBe("Colis abîmé");
  });

  it("refunds lines, at what they cost, and counts them", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { orderId } = await buy(ctx);
    const items = await ctx.orders.itemsOf(orderId);
    const standard = items.find((it) => it.rateBps === 2000)!;

    const { data } = await ctx.adminOrders.commerceAdminOrderRefund.fetch(
      {
        params: { id: orderId },
        body: {
          lines: [{ orderItemId: standard.id, quantity: 1 }],
          reason: "Retour d'une pièce",
        },
      },
      { user: admin },
    );

    expect(data.refundedTotal).toBe(12000);
    const [note] = await creditNotes(ctx, orderId, 1);
    expect(note!.vatBuckets.map((it) => it.rateBps)).toEqual([2000]);
    expect(note!.lines[0]!.quantity).toBe(-1);

    const after = (await ctx.orders.itemsOf(orderId)).find(
      (it) => it.id === standard.id,
    );
    expect(after!.refundedQuantity).toBe(1);
  });

  it("refuses more units than are left on the line", async ({ expect }) => {
    const ctx = await setup();
    const { orderId } = await buy(ctx);
    const items = await ctx.orders.itemsOf(orderId);
    const standard = items.find((it) => it.rateBps === 2000)!;

    await expect(
      ctx.adminOrders.commerceAdminOrderRefund.fetch(
        {
          params: { id: orderId },
          body: { lines: [{ orderItemId: standard.id, quantity: 3 }] },
        },
        { user: admin },
      ),
    ).rejects.toThrow(/2 left/);
  });

  it("refuses an amount over what is left", async ({ expect }) => {
    const ctx = await setup();
    const { orderId } = await buy(ctx);

    await expect(
      ctx.adminOrders.commerceAdminOrderRefund.fetch(
        { params: { id: orderId }, body: { amount: 999999 } },
        { user: admin },
      ),
    ).rejects.toThrow(/is left/);
    expect(await ctx.orders.refundsOf(orderId)).toEqual([]);
  });

  it("refunds what is left, and the notes add up to the invoice", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { orderId, invoice } = await buy(ctx);

    await ctx.adminOrders.commerceAdminOrderRefund.fetch(
      { params: { id: orderId }, body: { amount: 1000 } },
      { user: admin },
    );
    await creditNotes(ctx, orderId, 1);
    await ctx.adminOrders.commerceAdminOrderRefund.fetch(
      { params: { id: orderId }, body: {} },
      { user: admin },
    );

    expect((await ctx.orders.getById(orderId)).status).toBe("refunded");
    const notes = await creditNotes(ctx, orderId, 2);
    expect(notes.reduce((sum, it) => sum + it.grandTotal, 0)).toBe(
      -invoice.grandTotal,
    );
  });
});
