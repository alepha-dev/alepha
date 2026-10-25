import { Alepha } from "alepha";
import { JobProvider } from "alepha/api/jobs";
import {
  AlephaApiPayments,
  PaymentProvider,
  PaymentService,
  paymentIntents,
} from "alepha/api/payments";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import Stripe from "stripe";
import { describe, it } from "vitest";

import { StripePaymentProvider } from "../StripePaymentProvider.ts";

const WEBHOOK_SECRET = "whsec_test_platform_secret";
const CONNECT_SECRET = "whsec_test_connect_secret";
const SWEEP_JOB = "system.payments.expire-stale-intents";
const CLUB_ACCOUNT = "acct_club";

interface FakePaymentIntent {
  id: string;
  account?: string;
  status: string;
  cancellationReason?: string;
}

/**
 * The real provider, with only Stripe's HTTP calls replaced. Webhook
 * verification stays the SDK's own, so an event reaches the service exactly
 * as Stripe would deliver it. PaymentIntents are scoped to the account they
 * were created on, as on Stripe: asked from another account, they do not
 * exist.
 */
class FakeStripeProvider extends StripePaymentProvider {
  public readonly paymentIntentsById = new Map<string, FakePaymentIntent>();

  public stubStripe(): void {
    const webhooks = this.stripe.webhooks;
    const find = (id: string, options?: { stripeAccount?: string }) => {
      const pi = this.paymentIntentsById.get(id);
      if (!pi || pi.account !== options?.stripeAccount) {
        throw new Error(`No such payment_intent: '${id}'`);
      }
      return pi;
    };
    (this as unknown as { stripe: unknown }).stripe = {
      webhooks,
      paymentIntents: {
        create: async (
          params: { metadata: { intentId: string } },
          options?: { stripeAccount?: string },
        ) => {
          const id = `pi_${params.metadata.intentId.replaceAll("-", "")}`;
          this.paymentIntentsById.set(id, {
            id,
            account: options?.stripeAccount,
            status: "requires_payment_method",
          });
          return { id, client_secret: `${id}_secret_test` };
        },
        retrieve: async (
          id: string,
          _params: unknown,
          options?: { stripeAccount?: string },
        ) => find(id, options),
        cancel: async (
          id: string,
          params: { cancellation_reason?: string },
          options?: { stripeAccount?: string },
        ) => {
          const pi = find(id, options);
          pi.status = "canceled";
          pi.cancellationReason = params.cancellation_reason;
          return pi;
        },
      },
      checkout: {
        sessions: {
          // No Checkout session ever owns an element PaymentIntent.
          list: async () => ({ data: [] }),
        },
      },
    };
  }
}

class TestRepos {
  public readonly intents = $repository(paymentIntents);
}

const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      STRIPE_SECRET_KEY: "sk_test_dummyKeyForUnitTests",
      STRIPE_PUBLISHABLE_KEY: "pk_test_dummy",
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT_SECRET,
    },
  })
    .with(AlephaOrmPostgres)
    .with({ provide: PaymentProvider, use: FakeStripeProvider })
    .with(AlephaApiPayments)
    .with(TestRepos);
  const payments = alepha.inject(PaymentService);
  const provider = alepha.inject(PaymentProvider) as FakeStripeProvider;
  const repos = alepha.inject(TestRepos);
  const jobs = alepha.inject(JobProvider);
  const dateTime = alepha.inject(DateTimeProvider);
  provider.stubStripe();
  await alepha.start();

  const jobErrors: string[] = [];
  alepha.events.on("job:error", ({ name, error }) => {
    jobErrors.push(`${name}: ${String(error?.message)}`);
  });

  /**
   * An embedded payment opened `ageMin` minutes ago.
   */
  const openElement = async (ageMin = 0, stripeAccount?: string) => {
    const intent = await payments.createIntent(8900, "eur");
    const session = await payments.createElementSession(intent.id, {
      stripeAccount,
    });
    await repos.intents.updateById(intent.id, {
      createdAt: dateTime.now().subtract(ageMin, "minutes").toISOString(),
    });
    return { intentId: intent.id, session };
  };

  /**
   * A Stripe `payment_intent.*` event, signed like Stripe's own delivery.
   */
  const webhook = (
    type: string,
    paymentIntentId: string,
    account?: string,
  ): Request => {
    const payload = JSON.stringify({
      id: "evt_1",
      object: "event",
      type,
      account,
      data: { object: { object: "payment_intent", id: paymentIntentId } },
    });
    const signature = new Stripe(
      "sk_test_dummyKeyForUnitTests",
    ).webhooks.generateTestHeaderString({
      payload,
      secret: account ? CONNECT_SECRET : WEBHOOK_SECRET,
    });
    return new Request("https://shop.test/api/payments/webhook", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": signature },
    });
  };

  const sweep = () => jobs.trigger(SWEEP_JOB);

  return { payments, provider, jobErrors, openElement, webhook, sweep };
};

describe("Payment Element sessions", () => {
  it("records the PaymentIntent the browser confirms", async ({ expect }) => {
    const ctx = await setup();

    const { intentId, session } = await ctx.openElement();

    const intent = await ctx.payments.getIntent(intentId);
    expect(session.providerRef).toMatch(/^pi_/);
    expect(session.clientSecret).toBe(`${session.providerRef}_secret_test`);
    expect(intent.status).toBe("processing");
    expect(intent.providerRef).toBe(session.providerRef);
    expect(intent.providerAccount).toBeUndefined();
  });

  it("settles from Stripe's own payment_intent.succeeded webhook", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { intentId, session } = await ctx.openElement();

    await ctx.payments.handleWebhook(
      ctx.webhook("payment_intent.succeeded", session.providerRef),
    );

    expect((await ctx.payments.getIntent(intentId)).status).toBe("captured");
  });

  it("settles a payment on a connected account from the connect endpoint", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { intentId, session } = await ctx.openElement(0, CLUB_ACCOUNT);
    expect((await ctx.payments.getIntent(intentId)).providerAccount).toBe(
      CLUB_ACCOUNT,
    );

    const event = await ctx.provider.parseConnectWebhook(
      ctx.webhook(
        "payment_intent.succeeded",
        session.providerRef,
        CLUB_ACCOUNT,
      ),
    );
    await ctx.payments.handleParsedWebhook(event);

    expect(event.account).toBe(CLUB_ACCOUNT);
    expect((await ctx.payments.getIntent(intentId)).status).toBe("captured");
  });

  it("releases the intent when Stripe refuses the PaymentIntent", async ({
    expect,
  }) => {
    const ctx = await setup();
    const intent = await ctx.payments.createIntent(8900, "eur");
    (
      ctx.provider as unknown as {
        stripe: { paymentIntents: { create: () => Promise<never> } };
      }
    ).stripe.paymentIntents.create = async () => {
      throw new Error("Your card was declined.");
    };

    await expect(ctx.payments.createElementSession(intent.id)).rejects.toThrow(
      "Your card was declined.",
    );

    expect((await ctx.payments.getIntent(intent.id)).status).toBe("created");
  });

  it("the sweep cancels an abandoned PaymentIntent on the account it lives on", async ({
    expect,
  }) => {
    const ctx = await setup();
    const onPlatform = await ctx.openElement(45);
    const onClub = await ctx.openElement(45, CLUB_ACCOUNT);

    await ctx.sweep();

    expect(ctx.jobErrors).toEqual([]);
    for (const { intentId, session } of [onPlatform, onClub]) {
      expect((await ctx.payments.getIntent(intentId)).status).toBe("expired");
      expect(ctx.provider.paymentIntentsById.get(session.providerRef)).toEqual(
        expect.objectContaining({
          status: "canceled",
          cancellationReason: "abandoned",
        }),
      );
    }
  });

  it("the sweep settles a PaymentIntent whose webhook never came", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { intentId, session } = await ctx.openElement(45, CLUB_ACCOUNT);
    ctx.provider.paymentIntentsById.get(session.providerRef)!.status =
      "succeeded";

    await ctx.sweep();

    expect(ctx.jobErrors).toEqual([]);
    expect((await ctx.payments.getIntent(intentId)).status).toBe("captured");
  });
});
