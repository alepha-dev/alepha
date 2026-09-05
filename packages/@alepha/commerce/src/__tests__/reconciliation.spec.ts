import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import {
  MemoryPaymentProvider,
  PaymentProvider,
  PaymentService,
} from "alepha/api/payments";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { checkoutSessions } from "../checkout/entities/checkoutSessions.ts";
import { AlephaCommerceCheckout } from "../checkout/index.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { orders } from "../entities/orders.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { StockService } from "../services/StockService.ts";
import { AlephaCommerceSettlement } from "../settlement/index.ts";

const JOB = "SettlementJobs.checkoutReconciliation";

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

class ReconciliationProbe {
  executions = $repository(jobExecutionEntity);
  sessions = $repository(checkoutSessions);
  orders = $repository(orders);
}

/**
 * A memory PSP whose poll reports the charge captured: the buyer paid, the
 * webhook just never arrived. (The stock MemoryPaymentProvider is
 * deliberately unpollable, so abandoned-payment scenarios elsewhere in the
 * suite stay abandoned.)
 */
class PaidButWebhooklessProvider extends MemoryPaymentProvider {
  public override async retrieveSessionStatus(): Promise<"captured"> {
    return "captured";
  }
}

/**
 * A checkout whose FIRST `settle()` throws, the way a transient DB error or an
 * invoice-sequence hiccup would inside the `captured` webhook.
 */
class FlakySettleCheckoutService extends CheckoutService {
  public failNextSettle = true;

  public override async settle(
    sessionId: string,
    options: { paymentIntentId?: string } = {},
  ) {
    if (this.failNextSettle) {
      this.failNextSettle = false;
      throw new Error("transient failure while settling");
    }
    return super.settle(sessionId, options);
  }
}

const injectCtx = (alepha: Alepha) => ({
  alepha,
  catalog: alepha.inject(CatalogService),
  carts: alepha.inject(CartService),
  checkout: alepha.inject(CheckoutService),
  stock: alepha.inject(StockService),
  payments: alepha.inject(PaymentService),
  dt: alepha.inject(DateTimeProvider),
  probe: alepha.inject(ReconciliationProbe),
});

/**
 * Open a checkout and hand it to the payment rail.
 */
const payWithoutWebhook = async (ctx: ReturnType<typeof injectCtx>) => {
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
  return { sessionId: opened.id, intentId: handoff.intentId };
};

/**
 * The reconciliation for a session, matched on the payload: the key is
 * released when the row ends.
 */
const reconciliationFor = (probe: ReconciliationProbe, sessionId: string) =>
  probe.executions
    .findMany({ where: { jobName: { eq: JOB } } })
    .then((rows) =>
      rows.find(
        (r) => (r.payload as { sessionId?: string })?.sessionId === sessionId,
      ),
    );

/**
 * Wait until the reconciliation is parked: `scheduled` with its stamp. The
 * push writes the stamp before it returns, so this is a formality that
 * documents the discipline: park before travel.
 */
const waitForParkedReconcile = async (
  probe: ReconciliationProbe,
  executionId: string,
) => {
  await waitFor(
    () => probe.executions.findById(executionId),
    (r) => r?.status === "scheduled" && Boolean(r.scheduledAt),
    { label: "reconciliation parked" },
  );
};

describe("checkout reconciliation", () => {
  it("stands down when the webhook settles the checkout first", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaCommerceSettlement);
    const ctx = injectCtx(alepha);
    await alepha.start();

    const { sessionId, intentId } = await payWithoutWebhook(ctx);
    const scheduled = await waitFor(
      () => reconciliationFor(ctx.probe, sessionId),
      (e) => Boolean(e),
      { label: "reconciliation scheduled" },
    );
    expect(scheduled?.status).toBe("scheduled");
    expect(scheduled?.key).toBe(sessionId);

    await ctx.payments.handleWebhookEvent(intentId, "captured");

    const cancelled = await waitFor(
      () => reconciliationFor(ctx.probe, sessionId),
      (e) => e?.status === "cancelled",
      { label: "reconciliation cancelled after webhook settle" },
    );
    expect(cancelled?.cancelledByName).toBe("checkout settled");

    const session = await ctx.probe.sessions.findById(sessionId);
    expect(session?.status).toBe("completed");
  });

  it(
    "recovers a paid checkout whose webhook never arrived",
    {
      timeout: 30_000,
    },
    async ({ expect }) => {
      const alepha = Alepha.create()
        .with({ provide: PaymentProvider, use: PaidButWebhooklessProvider })
        .with(AlephaOrmPostgres)
        .with(AlephaCommerceSettlement);
      const ctx = injectCtx(alepha);
      await alepha.start();

      // The buyer paid, but no webhook is ever delivered. Exactly the
      // Mollie-without-webhook gap.
      const { sessionId } = await payWithoutWebhook(ctx);

      const scheduled = await waitFor(
        () => reconciliationFor(ctx.probe, sessionId),
        (e) => Boolean(e),
        { label: "reconciliation scheduled" },
      );
      await waitForParkedReconcile(ctx.probe, scheduled!.id);

      await ctx.dt.travel([26, "minute"]);

      await waitFor(
        async () => (await ctx.probe.sessions.findById(sessionId))?.status,
        (s) => s === "completed",
        {
          label: "stranded paid checkout settled",
          interval: 100,
          timeout: 25_000,
        },
      );

      const session = await ctx.probe.sessions.findById(sessionId);
      const order = await ctx.probe.orders.findById(session!.orderId!);
      expect(order?.status).toBe("paid");

      const done = await waitFor(
        () => ctx.probe.executions.findById(scheduled!.id),
        (e) => e?.status === "ok",
        { label: "reconciliation completed" },
      );
      expect(done?.status).toBe("ok");
    },
  );

  it(
    "abandons a checkout the PSP cannot confirm",
    { timeout: 30_000 },
    async ({ expect }) => {
      const alepha = Alepha.create()
        .with(AlephaOrmPostgres)
        .with(AlephaCommerceSettlement);
      const ctx = injectCtx(alepha);
      await alepha.start();

      const { sessionId } = await payWithoutWebhook(ctx);

      const scheduled = await waitFor(
        () => reconciliationFor(ctx.probe, sessionId),
        (e) => Boolean(e),
        { label: "reconciliation scheduled" },
      );
      await waitForParkedReconcile(ctx.probe, scheduled!.id);

      await ctx.dt.travel([26, "minute"]);

      await waitFor(
        async () => (await ctx.probe.sessions.findById(sessionId))?.status,
        (s) => s === "abandoned",
        {
          label: "unconfirmable checkout abandoned",
          interval: 100,
          timeout: 25_000,
        },
      );

      const session = await ctx.probe.sessions.findById(sessionId);
      const order = await ctx.probe.orders.findById(session!.orderId!);
      expect(order?.status).toBe("cancelled");
    },
  );

  it("payments:expired closes the graveyard even without the settlement module", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaCommerceCheckout);
    const ctx = injectCtx(alepha);
    await alepha.start();

    const { sessionId } = await payWithoutWebhook(ctx);

    // The payments expiry sweep (30-minute cutoff, 15-minute cron) fires
    // during the travel, expires the unpollable intent, and its new
    // `payments:expired` event abandons the checkout.
    await ctx.dt.travel([36, "minute"]);

    await waitFor(
      async () => (await ctx.probe.sessions.findById(sessionId))?.status,
      (s) => s === "abandoned",
      { label: "expired checkout abandoned" },
    );

    const session = await ctx.probe.sessions.findById(sessionId);
    const order = await ctx.probe.orders.findById(session!.orderId!);
    expect(order?.status).toBe("cancelled");
  });

  it("the expiry sweep itself recovers a paid-but-webhookless intent", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: PaymentProvider, use: PaidButWebhooklessProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaCommerceCheckout);
    const ctx = injectCtx(alepha);
    await alepha.start();

    const { sessionId } = await payWithoutWebhook(ctx);

    // No settlement module here: the sweep alone must ask the PSP before
    // expiring, find the capture, and settle instead of stomping to
    // "expired".
    await ctx.dt.travel([36, "minute"]);

    await waitFor(
      async () => (await ctx.probe.sessions.findById(sessionId))?.status,
      (s) => s === "completed",
      { label: "sweep-recovered checkout settled" },
    );

    const session = await ctx.probe.sessions.findById(sessionId);
    const order = await ctx.probe.orders.findById(session!.orderId!);
    expect(order?.status).toBe("paid");
  });

  /**
   * `settle()` threw inside the `captured` webhook.
   *
   * Nothing retries it: the intent is already captured, and `syncIntent`
   * returns early on a terminal status, so it has nothing left to replay. The
   * reconciliation then saw a `paying` session with an old intent and
   * abandoned it, cancelling an order the customer had paid for.
   *
   * The settle it performs emits `commerce:order:paid`, whose listener
   * cancels the reconciliation by key. The row is running at that moment, so
   * `cancelByKey` leaves it alone and the execution that rescued the money
   * ends as `ok`, not `cancelled`.
   */
  it(
    "settles a checkout whose captured webhook failed, instead of cancelling it",
    { timeout: 30_000 },
    async ({ expect }) => {
      const alepha = Alepha.create()
        .with({ provide: CheckoutService, use: FlakySettleCheckoutService })
        .with(AlephaOrmPostgres)
        .with(AlephaCommerceSettlement);
      const ctx = injectCtx(alepha);
      await alepha.start();

      const { sessionId, intentId } = await payWithoutWebhook(ctx);
      const scheduled = await waitFor(
        () => reconciliationFor(ctx.probe, sessionId),
        (e) => Boolean(e),
        { label: "reconciliation scheduled" },
      );
      await waitForParkedReconcile(ctx.probe, scheduled!.id);

      // The capture lands, and settling it fails.
      await ctx.payments
        .handleWebhookEvent(intentId, "captured")
        .catch(() => undefined);

      // The money is taken and the checkout is stranded: exactly the state
      // the reconciliation has to resolve.
      expect((await ctx.probe.sessions.findById(sessionId))?.status).toBe(
        "paying",
      );
      expect((await ctx.payments.getIntent(intentId)).status).toBe("captured");

      await ctx.dt.travel([26, "minute"]);

      await waitFor(
        async () => (await ctx.probe.sessions.findById(sessionId))?.status,
        (s) => s === "completed",
        { label: "reconciliation settled the captured checkout" },
      );

      const session = await ctx.probe.sessions.findById(sessionId);
      const order = await ctx.probe.orders.findById(session!.orderId!);
      expect(order?.status).toBe("paid");

      const done = await waitFor(
        () => ctx.probe.executions.findById(scheduled!.id),
        (e) => e?.status === "ok",
        { label: "the rescuing run completed, not cancelled by its own event" },
      );
      expect(done?.status).toBe("ok");
    },
  );
});
