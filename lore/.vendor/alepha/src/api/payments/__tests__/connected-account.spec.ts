import { Alepha } from "alepha";
import { JobProvider } from "alepha/api/jobs";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import { paymentIntents } from "../entities/paymentIntents.ts";
import type { PaymentIntentEntity } from "../entities/paymentIntents.ts";
import { AlephaApiPayments } from "../index.ts";
import { MemoryPaymentProvider } from "../providers/MemoryPaymentProvider.ts";
import { PaymentProvider } from "../providers/PaymentProvider.ts";
import { PaymentService } from "../services/PaymentService.ts";

const SWEEP_JOB = "system.payments.expire-stale-intents";
const CLUB_ACCOUNT = "acct_club";

/**
 * Stripe's account scoping, in memory. A session created on a connected
 * account (a direct charge) exists only there: asked from any other account,
 * the platform included, Stripe answers `resource_missing`. So a call that
 * forgets the account reads nothing, closes nothing, and moves no money.
 */
class AccountScopedProvider extends MemoryPaymentProvider {
  protected readonly accounts = new Map<string, string | undefined>();
  /** Sessions the buyer completed on the PSP page. */
  public readonly paid = new Set<string>();

  public override async createSession(
    intent: PaymentIntentEntity,
    options: Parameters<MemoryPaymentProvider["createSession"]>[1],
  ) {
    const result = await super.createSession(intent, options);
    this.accounts.set(result.providerRef, options.stripeAccount);
    return result;
  }

  protected reachable(
    providerRef: string,
    options: { stripeAccount?: string } = {},
  ): boolean {
    return (
      this.accounts.has(providerRef) &&
      this.accounts.get(providerRef) === options.stripeAccount
    );
  }

  protected assertReachable(
    providerRef: string,
    options?: { stripeAccount?: string },
  ): void {
    if (!this.reachable(providerRef, options)) {
      throw new Error(`No such payment_intent: '${providerRef}'`);
    }
  }

  public override async retrieveSessionStatus(
    providerRef: string,
    options?: { stripeAccount?: string },
  ): Promise<"authorized" | "captured" | "failed" | null> {
    // The Stripe provider catches the lookup error and answers null.
    if (!this.reachable(providerRef, options)) {
      return null;
    }
    return this.paid.has(providerRef) ? "captured" : null;
  }

  public override async expireSession(
    providerRef: string,
    options?: { stripeAccount?: string },
  ): Promise<void> {
    // The Stripe provider catches the error and logs a warning.
    if (this.reachable(providerRef, options)) {
      await super.expireSession(providerRef);
    }
  }

  public override async capturePayment(
    providerRef: string,
    amount: number,
    options?: { stripeAccount?: string },
  ): Promise<void> {
    this.assertReachable(providerRef, options);
    await super.capturePayment(providerRef, amount);
  }

  public override async voidPayment(
    providerRef: string,
    options?: { stripeAccount?: string },
  ): Promise<void> {
    this.assertReachable(providerRef, options);
    await super.voidPayment(providerRef);
  }

  public override async refundPayment(
    providerRef: string,
    amount: number,
    options?: { stripeAccount?: string },
  ) {
    this.assertReachable(providerRef, options);
    return super.refundPayment(providerRef, amount);
  }
}

class TestRepos {
  public readonly intents = $repository(paymentIntents);
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaOrmPostgres)
    .with({ provide: PaymentProvider, use: AccountScopedProvider })
    .with(AlephaApiPayments)
    .with(TestRepos);
  const payments = alepha.inject(PaymentService);
  const provider = alepha.inject(PaymentProvider) as AccountScopedProvider;
  const repos = alepha.inject(TestRepos);
  const jobs = alepha.inject(JobProvider);
  await alepha.start();

  const jobErrors: string[] = [];
  alepha.events.on("job:error", ({ name, error }) => {
    jobErrors.push(`${name}: ${String(error?.message)}`);
  });

  /** A checkout session opened `ageMin` minutes ago. */
  const openSession = async (
    ageMin: number,
    options: { stripeAccount?: string; authorize?: boolean } = {},
  ) => {
    const intent = await payments.createIntent(1500, "eur");
    await payments.createSession(
      intent.id,
      "https://example.com/return",
      options.authorize,
      undefined,
      { stripeAccount: options.stripeAccount },
    );
    await repos.intents.updateById(intent.id, {
      createdAt: new Date(Date.now() - ageMin * 60_000).toISOString(),
    });
    return await payments.getIntent(intent.id);
  };

  const sweep = () => jobs.trigger(SWEEP_JOB);

  return { alepha, payments, provider, jobErrors, openSession, sweep };
};

describe("payments on a connected account", () => {
  it("records the account a session was created on", async ({ expect }) => {
    const ctx = await setup();

    const onClub = await ctx.openSession(0, { stripeAccount: CLUB_ACCOUNT });
    const onPlatform = await ctx.openSession(0);

    expect(onClub.providerAccount).toBe(CLUB_ACCOUNT);
    expect(onPlatform.providerAccount).toBeUndefined();
  });

  it("the sweep settles a session the buyer paid on the connected account", async ({
    expect,
  }) => {
    const ctx = await setup();
    const intent = await ctx.openSession(45, { stripeAccount: CLUB_ACCOUNT });
    ctx.provider.paid.add(intent.providerRef!);

    await ctx.sweep();

    expect(ctx.jobErrors).toEqual([]);
    expect((await ctx.payments.getIntent(intent.id)).status).toBe("captured");
  });

  it("the sweep closes an abandoned session on the account it lives on", async ({
    expect,
  }) => {
    const ctx = await setup();
    const onClub = await ctx.openSession(45, { stripeAccount: CLUB_ACCOUNT });
    const onPlatform = await ctx.openSession(45);

    await ctx.sweep();

    expect(ctx.jobErrors).toEqual([]);
    for (const intent of [onClub, onPlatform]) {
      expect((await ctx.payments.getIntent(intent.id)).status).toBe("expired");
      expect(ctx.provider.wasExpired(intent.providerRef!)).toBe(true);
    }
  });

  it("captures and voids an authorization on the account it lives on", async ({
    expect,
  }) => {
    const ctx = await setup();
    const toCapture = await ctx.openSession(0, {
      stripeAccount: CLUB_ACCOUNT,
      authorize: true,
    });
    const toVoid = await ctx.openSession(0, {
      stripeAccount: CLUB_ACCOUNT,
      authorize: true,
    });
    await ctx.payments.handleWebhookEvent(toCapture.id, "authorized");
    await ctx.payments.handleWebhookEvent(toVoid.id, "authorized");

    await ctx.payments.capture(toCapture.id);
    await ctx.payments.void(toVoid.id);

    expect((await ctx.payments.getIntent(toCapture.id)).status).toBe(
      "captured",
    );
    expect((await ctx.payments.getIntent(toVoid.id)).status).toBe("voided");
  });

  it("refunds on the recorded account when the caller names none", async ({
    expect,
  }) => {
    const ctx = await setup();
    const intent = await ctx.openSession(0, { stripeAccount: CLUB_ACCOUNT });
    await ctx.payments.handleWebhookEvent(intent.id, "captured");

    await ctx.payments.refund(intent.id, 1500);

    expect((await ctx.payments.getIntent(intent.id)).status).toBe("refunded");
    expect(ctx.provider.wasRefunded(intent.providerRef!)).toBe(true);
  });
});
