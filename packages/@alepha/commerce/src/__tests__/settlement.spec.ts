import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import { PaymentService } from "alepha/api/payments";
import { MemoryEmailProvider } from "alepha/email";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { AlephaCommerceInvoicing } from "../invoicing/index.ts";
import { InvoiceService } from "../invoicing/services/InvoiceService.ts";
import { AlephaCommerceNotifications } from "../notifications/index.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { StockService } from "../services/StockService.ts";
import { AlephaCommerceSettlement } from "../settlement/index.ts";

const JOB = "SettlementJobs.orderSettlement";

/**
 * Poll `fn` until `predicate` returns true, or throw on timeout.
 */
async function waitFor<T>(
  fn: () => Promise<T> | T,
  predicate: (v: T) => boolean,
  { timeout = 10_000, interval = 20, label = "condition" } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: T = await fn();
  while (Date.now() < deadline) {
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, interval));
    last = await fn();
  }
  if (predicate(last)) return last;
  throw new Error(`waitFor: ${label} not met within ${timeout}ms`);
}

class SettlementProbe {
  executions = $repository(jobExecutionEntity);
}

/**
 * Find the settlement execution for an order. Matched on the payload, not
 * the dedup key: the key is released when the row ends, so `key = orderId`
 * only matches live rows.
 */
async function findSettlement(probe: SettlementProbe, orderId: string) {
  const rows = await probe.executions.findMany({
    where: { jobName: { eq: JOB } },
  });
  return rows.find(
    (r) => (r.payload as { orderId?: string })?.orderId === orderId,
  );
}

/**
 * Drive a real cart, checkout, captured-webhook flow and return the order
 * id the settlement job was pushed for.
 */
async function payOneOrder(ctx: {
  catalog: CatalogService;
  stock: StockService;
  carts: CartService;
  checkout: CheckoutService;
  payments: PaymentService;
}): Promise<string> {
  const ring = await ctx.catalog.create({
    slug: `ring-${randomUUID()}`,
    name: "Bague Aurore",
    price: 8900,
    published: true,
    config: { trackStock: true },
  });
  await ctx.stock.recordIntake(ring.id, 2);

  const cart = await ctx.carts.resolve(ctx.carts.newToken());
  await ctx.carts.add(cart.id, ring.id, 1);
  const opened = await ctx.checkout.start(cart.id, {
    email: "camille@example.com",
  });
  const { handoff } = await ctx.checkout.pay(opened.id, {
    returnUrl: "https://bijoux.example/merci",
  });
  await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

  const session = await ctx.checkout.getById(opened.id);
  if (!session.orderId) throw new Error("checkout produced no order");
  return session.orderId;
}

const makeFullApp = () =>
  Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaCommerceInvoicing)
    .with(AlephaCommerceNotifications)
    .with(AlephaCommerceSettlement);

const injectCtx = (alepha: Alepha) => ({
  alepha,
  catalog: alepha.inject(CatalogService),
  carts: alepha.inject(CartService),
  checkout: alepha.inject(CheckoutService),
  stock: alepha.inject(StockService),
  payments: alepha.inject(PaymentService),
  probe: alepha.inject(SettlementProbe),
});

describe("commerce settlement job", () => {
  it("issues the invoice and sends the confirmation, durably", async ({
    expect,
  }) => {
    const alepha = makeFullApp();
    const ctx = injectCtx(alepha);
    await alepha.start();

    const orderId = await payOneOrder(ctx);

    const exec = await waitFor(
      () => findSettlement(ctx.probe, orderId),
      (e) => e?.status === "ok",
      { label: "settlement completed" },
    );
    expect(exec?.jobName).toBe(JOB);
    expect(exec?.attempt).toBe(1);

    const invoices = await alepha.inject(InvoiceService).listForOrder(orderId);
    expect(invoices).toHaveLength(1);

    const mail = alepha.inject(MemoryEmailProvider);
    const confirmation = mail.records.find(
      (r) => r.to === "camille@example.com",
    );
    expect(confirmation).toBeDefined();
  });

  it(
    "retries a failed invoice stage instead of losing the invoice",
    {
      timeout: 20_000,
    },
    async ({ expect }) => {
      class FlakyInvoiceService extends InvoiceService {
        public failures = 0;
        public override async issueForOrder(orderId: string) {
          if (this.failures < 1) {
            this.failures++;
            throw new Error("invoice renderer down (test)");
          }
          return super.issueForOrder(orderId);
        }
      }

      // The substitution must land before the modules: invoicing's
      // `register` resolves InvoiceService eagerly at module wiring time.
      const alepha = Alepha.create()
        .with({ provide: InvoiceService, use: FlakyInvoiceService })
        .with(AlephaOrmPostgres)
        .with(AlephaCommerceInvoicing)
        .with(AlephaCommerceNotifications)
        .with(AlephaCommerceSettlement);
      const ctx = injectCtx(alepha);
      await alepha.start();

      const orderId = await payOneOrder(ctx);

      // The first attempt fails and the retry lands on the job's own curve:
      // one second at most for the first retry, so no travel is needed.
      const exec = await waitFor(
        () => findSettlement(ctx.probe, orderId),
        (e) => e?.status === "ok",
        {
          label: "settlement completed after retry",
          timeout: 18_000,
          interval: 100,
        },
      );
      expect(exec?.attempt).toBe(2);
      expect(
        (alepha.inject(InvoiceService) as FlakyInvoiceService).failures,
      ).toBe(1);

      const invoices = await alepha
        .inject(InvoiceService)
        .listForOrder(orderId);
      expect(invoices).toHaveLength(1);
    },
  );

  it("runs one settlement per order even when the webhook is redelivered", async ({
    expect,
  }) => {
    const alepha = makeFullApp();
    const ctx = injectCtx(alepha);
    await alepha.start();

    const orderId = await payOneOrder(ctx);

    await waitFor(
      () => findSettlement(ctx.probe, orderId),
      (e) => e?.status === "ok",
      { label: "settlement completed" },
    );

    // Redeliver: markPaid's transition guard means no second event, and
    // the job key would dedup one anyway.
    const rows = await ctx.probe.executions.findMany({
      where: { jobName: { eq: JOB } },
    });
    const forThisOrder = rows.filter(
      (r) => (r.payload as { orderId?: string })?.orderId === orderId,
    );
    expect(forThisOrder).toHaveLength(1);

    const invoices = await alepha.inject(InvoiceService).listForOrder(orderId);
    expect(invoices).toHaveLength(1);
  });

  it("skips the confirmation stage when notifications are not loaded", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaCommerceInvoicing)
      .with(AlephaCommerceSettlement);
    const ctx = injectCtx(alepha);
    await alepha.start();

    const orderId = await payOneOrder(ctx);

    const exec = await waitFor(
      () => findSettlement(ctx.probe, orderId),
      (e) => e?.status === "ok",
      { label: "settlement completed without notifications" },
    );
    expect(exec?.status).toBe("ok");

    const invoices = await alepha.inject(InvoiceService).listForOrder(orderId);
    expect(invoices).toHaveLength(1);
  });
});
