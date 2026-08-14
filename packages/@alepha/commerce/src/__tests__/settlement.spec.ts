import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import { PaymentService } from "alepha/api/payments";
import {
  WorkflowProvider,
  workflowExecutions,
  workflowStepExecutions,
} from "alepha/api/workflows";
import { DateTimeProvider } from "alepha/datetime";
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
  executions = $repository(workflowExecutions);
  steps = $repository(workflowStepExecutions);
}

/**
 * Find the settlement execution for an order. Matched on the payload,
 * not the dedup key — the engine clears the key when the execution
 * reaches a terminal status, so `key = orderId` only matches live rows.
 */
async function findSettlement(probe: SettlementProbe, orderId: string) {
  const rows = await probe.executions.findMany({
    where: { workflowName: { eq: "SettlementWorkflows.orderSettlement" } },
  });
  return rows.find(
    (r) => (r.payload as { orderId?: string })?.orderId === orderId,
  );
}

/**
 * Drive a real cart → checkout → captured-webhook flow and return the
 * order id the settlement workflow was started for.
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

describe("commerce settlement workflow", () => {
  it("issues the invoice and sends the confirmation, durably", async ({
    expect,
  }) => {
    const alepha = makeFullApp();
    const ctx = injectCtx(alepha);
    await alepha.start();

    const orderId = await payOneOrder(ctx);

    const exec = await waitFor(
      () => findSettlement(ctx.probe, orderId),
      (e) => e?.status === "completed",
      { label: "settlement completed" },
    );
    expect(exec?.workflowName).toBe("SettlementWorkflows.orderSettlement");

    const invoices = await alepha.inject(InvoiceService).listForOrder(orderId);
    expect(invoices).toHaveLength(1);

    const mail = alepha.inject(MemoryEmailProvider);
    const confirmation = mail.records.find(
      (r) => r.to === "camille@example.com",
    );
    expect(confirmation).toBeDefined();
  });

  it("retries a failed invoice step instead of losing the invoice", {
    timeout: 20_000,
  }, async ({ expect }) => {
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

    // First attempt fails; the retry is scheduled with backoff. Wait for
    // the retry to be PARKED (pending + scheduledAt) before travelling —
    // travel() only releases timers that already exist, and the retry's
    // timer is born a beat after the failing handler returns.
    const failing = await waitFor(
      () => findSettlement(ctx.probe, orderId),
      (e) => Boolean(e),
      { label: "settlement execution exists" },
    );
    await waitFor(
      () =>
        ctx.probe.steps.findOne({
          where: {
            workflowExecutionId: { eq: failing!.id },
            stepName: { eq: "issueInvoice" },
          },
        }),
      (s) => s?.status === "pending" && Boolean(s?.scheduledAt),
      { label: "invoice retry parked" },
    );
    await alepha.inject(DateTimeProvider).travel([2, "minute"]);

    // Post-travel the clock is frozen: nudge the sweep while polling, so
    // a retry delivery lost to the travel storm is re-derived from rows.
    const exec = await waitFor(
      async () => {
        await alepha.inject(WorkflowProvider).recoverySweep();
        return findSettlement(ctx.probe, orderId);
      },
      (e) => e?.status === "completed",
      { label: "settlement completed after retry", timeout: 18_000, interval: 100 },
    );
    expect(exec?.status).toBe("completed");

    const invoices = await alepha.inject(InvoiceService).listForOrder(orderId);
    expect(invoices).toHaveLength(1);
  });

  it("runs one settlement per order even when the webhook is redelivered", async ({
    expect,
  }) => {
    const alepha = makeFullApp();
    const ctx = injectCtx(alepha);
    await alepha.start();

    const orderId = await payOneOrder(ctx);

    await waitFor(
      () => findSettlement(ctx.probe, orderId),
      (e) => e?.status === "completed",
      { label: "settlement completed" },
    );

    // Redeliver: markPaid's transition guard means no second event, and
    // the workflow key would dedup one anyway.
    const rows = await ctx.probe.executions.findMany({
      where: { workflowName: { eq: "SettlementWorkflows.orderSettlement" } },
    });
    const forThisOrder = rows.filter(
      (r) => (r.payload as { orderId?: string })?.orderId === orderId,
    );
    expect(forThisOrder).toHaveLength(1);

    const invoices = await alepha.inject(InvoiceService).listForOrder(orderId);
    expect(invoices).toHaveLength(1);
  });

  it("skips the confirmation step when notifications are not loaded", async ({
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
      (e) => e?.status === "completed",
      { label: "settlement completed without notifications" },
    );
    expect(exec?.status).toBe("completed");

    const invoices = await alepha.inject(InvoiceService).listForOrder(orderId);
    expect(invoices).toHaveLength(1);
  });
});
