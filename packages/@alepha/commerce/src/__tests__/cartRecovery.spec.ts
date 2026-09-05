import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import { PaymentService } from "alepha/api/payments";
import { DateTimeProvider } from "alepha/datetime";
import { MemoryEmailProvider } from "alepha/email";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { CartService } from "../cart/services/CartService.ts";
import { checkoutSessions } from "../checkout/entities/checkoutSessions.ts";
import { CheckoutService } from "../checkout/services/CheckoutService.ts";
import { AlephaCommerceRecovery } from "../recovery/index.ts";
import { CatalogService } from "../services/CatalogService.ts";
import { StockService } from "../services/StockService.ts";

const JOB = "CartRecoveryJobs.cartRecovery";

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

class RecoveryProbe {
  executions = $repository(jobExecutionEntity);
  sessions = $repository(checkoutSessions);
}

/**
 * Wait until the sequence is parked on `stage`: the row is `scheduled` with
 * that stage in its payload (the first reminder carries no stage yet).
 * travel() only fires timers that already exist, and the next stage's timer
 * is armed after the previous handler resolves, so a travel issued before the
 * park would compute the next delay from the travelled clock.
 */
const waitForParked = async (
  probe: RecoveryProbe,
  executionId: string,
  stage: string | undefined,
) => {
  await waitFor(
    () => probe.executions.findById(executionId),
    (r) =>
      r?.status === "scheduled" &&
      (r.payload as { stage?: string })?.stage === stage &&
      Boolean(r.scheduledAt),
    { label: `sequence parked on ${stage ?? "the first reminder"}` },
  );
};

const setup = async () => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaCommerceRecovery);

  const ctx = {
    alepha,
    catalog: alepha.inject(CatalogService),
    carts: alepha.inject(CartService),
    checkout: alepha.inject(CheckoutService),
    stock: alepha.inject(StockService),
    payments: alepha.inject(PaymentService),
    mail: alepha.inject(MemoryEmailProvider),
    dt: alepha.inject(DateTimeProvider),
    probe: alepha.inject(RecoveryProbe),
  };
  await alepha.start();
  return ctx;
};

/**
 * Open a checkout and return its cart id. `email: null` opens one with no
 * email on file, since `undefined` would trip the default-parameter value.
 */
const openCheckout = async (
  ctx: Awaited<ReturnType<typeof setup>>,
  email: string | null = "camille@example.com",
) => {
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
    email: email ?? undefined,
  });
  return { cartId: cart.id, sessionId: opened.id };
};

/**
 * The sequence for a cart, matched on the payload rather than the key: the
 * key is released when the row ends, so `key = cartId` only matches live
 * rows.
 */
const recoveryFor = (probe: RecoveryProbe, cartId: string) =>
  probe.executions
    .findMany({ where: { jobName: { eq: JOB } } })
    .then((rows) =>
      rows.find((r) => (r.payload as { cartId?: string })?.cartId === cartId),
    );

describe("cart recovery sequence", () => {
  it(
    "reminds twice, then marks the checkout abandoned",
    {
      timeout: 30_000,
    },
    async ({ expect }) => {
      const ctx = await setup();
      const { cartId, sessionId } = await openCheckout(ctx);

      // The sequence exists and is parked on its first delay: no mail yet.
      const parked = await waitFor(
        () => recoveryFor(ctx.probe, cartId),
        (e) => Boolean(e),
        { label: "recovery sequence started" },
      );
      expect(parked?.status).toBe("scheduled");
      expect(parked?.key).toBe(cartId);
      expect(ctx.mail.records).toHaveLength(0);

      // First reminder after ~1h.
      await waitForParked(ctx.probe, parked!.id, undefined);
      await ctx.dt.travel([61, "minute"]);
      await waitFor(
        () => ctx.mail.records.length,
        (n) => n >= 1,
        { label: "first reminder sent", interval: 100 },
      );
      expect(ctx.mail.records[0]!.to).toBe("camille@example.com");
      expect(ctx.mail.records[0]!.subject).toContain("panier");

      // Second reminder after ~23h more: the same row, rescheduled.
      await waitForParked(ctx.probe, parked!.id, "secondReminder");
      await ctx.dt.travel([24, "hour"]);
      await waitFor(
        () => ctx.mail.records.length,
        (n) => n >= 2,
        { label: "second reminder sent", interval: 100 },
      );

      // Abandon after ~24h more.
      await waitForParked(ctx.probe, parked!.id, "markAbandoned");
      await ctx.dt.travel([25, "hour"]);
      await waitFor(
        async () => (await ctx.probe.sessions.findById(sessionId))?.status,
        (s) => s === "abandoned",
        { label: "session marked abandoned", interval: 100 },
      );

      const done = await waitFor(
        () => ctx.probe.executions.findById(parked!.id),
        (e) => e?.status === "ok",
        { label: "recovery sequence completed" },
      );
      expect(done?.status).toBe("ok");
      expect(ctx.mail.records).toHaveLength(2);
    },
  );

  it("stands down the moment the checkout converts", async ({ expect }) => {
    const ctx = await setup();
    const { cartId, sessionId } = await openCheckout(ctx);

    await waitFor(
      () => recoveryFor(ctx.probe, cartId),
      (e) => Boolean(e),
      { label: "recovery sequence started" },
    );

    // Pay before the first reminder fires.
    const { handoff } = await ctx.checkout.pay(sessionId, {
      returnUrl: "https://bijoux.example/merci",
    });
    await ctx.payments.handleWebhookEvent(handoff.intentId, "captured");

    const cancelled = await waitFor(
      () => recoveryFor(ctx.probe, cartId),
      (e) => e?.status === "cancelled",
      { label: "recovery sequence cancelled on conversion" },
    );
    expect(cancelled?.cancelledByName).toBe("checkout converted");

    // Even a long travel produces no reminder afterwards.
    await ctx.dt.travel([3, "day"]);
    await new Promise((r) => setTimeout(r, 200));
    expect(ctx.mail.records).toHaveLength(0);
  });

  it("starts nothing for a checkout without an email", async ({ expect }) => {
    const ctx = await setup();
    const { cartId } = await openCheckout(ctx, null);

    await new Promise((r) => setTimeout(r, 200));
    expect(await recoveryFor(ctx.probe, cartId)).toBeUndefined();
  });

  it("lands on one sequence when the email is set twice", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { cartId, sessionId } = await openCheckout(ctx);

    await ctx.checkout.setEmail(sessionId, "camille+corrige@example.com");

    await waitFor(
      () => recoveryFor(ctx.probe, cartId),
      (e) => Boolean(e),
      { label: "recovery sequence started" },
    );

    const rows = await ctx.probe.executions.findMany({
      where: { jobName: { eq: JOB } },
    });
    const forThisCart = rows.filter(
      (r) => (r.payload as { cartId?: string })?.cartId === cartId,
    );
    expect(forThisCart).toHaveLength(1);
  });
});
