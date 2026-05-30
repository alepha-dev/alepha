import { $env, $inject, Alepha, AlephaError, type Static, t } from "alepha";
import type {
  CreatePaymentMethodResult,
  CreateSessionResult,
  PaymentIntentEntity,
  PaymentProvider,
  RefundResult,
  WebhookEvent,
} from "alepha/api/payments";
import { $cache } from "alepha/cache";
import { DatabaseCacheProvider } from "alepha/cache/database";
import { $logger } from "alepha/logger";
import Stripe from "stripe";

const envSchema = t.object({
  STRIPE_SECRET_KEY: t.string(),
  STRIPE_WEBHOOK_SECRET: t.string(),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

export class StripePaymentProvider implements PaymentProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly env = $env(envSchema);
  protected readonly stripe: Stripe;

  /**
   * Shared cache of Alepha userId → Stripe customer ID.
   * The mapping is immutable once created, so a long TTL is safe.
   * On cache miss, customers are re-discovered via Stripe search.
   */
  protected readonly customerCache = $cache<string>({
    name: "stripe:customers",
    ttl: [30, "days"],
    provider: DatabaseCacheProvider,
  });

  constructor() {
    this.stripe = new Stripe(this.env.STRIPE_SECRET_KEY);
  }

  /**
   * Get or create a Stripe customer for the given Alepha user ID.
   * Uses local cache first, then searches Stripe by metadata, and
   * creates a new customer if none is found.
   */
  protected async getOrCreateCustomer(userId: string): Promise<string> {
    const cached = await this.customerCache.get(userId);
    if (cached) return cached;

    const existing = await this.stripe.customers.search({
      query: `metadata["alepha_user_id"]:"${userId}"`,
      limit: 1,
    });

    if (existing.data.length > 0) {
      const customerId = existing.data[0].id;
      await this.customerCache.set(userId, customerId);
      return customerId;
    }

    const customer = await this.stripe.customers.create({
      metadata: { alepha_user_id: userId },
    });

    await this.customerCache.set(userId, customer.id);
    return customer.id;
  }

  public async createSession(
    intent: PaymentIntentEntity,
    options: {
      returnUrl: string;
      authorize?: boolean;
      stripeAccount?: string;
      applicationFeeAmount?: number;
    },
  ): Promise<CreateSessionResult> {
    const customer = intent.userId
      ? await this.getOrCreateCustomer(intent.userId)
      : undefined;

    const paymentIntentData: Stripe.Checkout.SessionCreateParams["payment_intent_data"] =
      options.authorize ? { capture_method: "manual" } : {};
    if (options.applicationFeeAmount && options.applicationFeeAmount > 0) {
      paymentIntentData.application_fee_amount = options.applicationFeeAmount;
    }

    const session = await this.stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer,
        line_items: [
          {
            price_data: {
              currency: intent.currency,
              unit_amount: intent.amount,
              product_data: { name: "Payment" },
            },
            quantity: 1,
          },
        ],
        payment_intent_data:
          Object.keys(paymentIntentData).length > 0
            ? paymentIntentData
            : undefined,
        success_url: options.returnUrl,
        cancel_url: options.returnUrl,
        metadata: { intentId: intent.id },
        // Force eager PaymentIntent creation. Without expand, Stripe may return
        // `payment_intent: null` for sessions that lazy-create the PI (depends
        // on enabled payment methods / account configuration).
        expand: ["payment_intent"],
      },
      options.stripeAccount
        ? { stripeAccount: options.stripeAccount }
        : undefined,
    );

    if (!session.url) {
      throw new AlephaError("Stripe checkout session is missing URL");
    }

    // Prefer the PaymentIntent ID (used by webhook matching). Fall back to
    // the Session ID for sessions where the PI is created lazily — webhooks
    // for those will match via metadata.intentId instead.
    const providerRef = session.payment_intent
      ? typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent.id
      : session.id;

    return {
      url: session.url,
      providerRef,
    };
  }

  public async capturePayment(
    providerRef: string,
    amount: number,
    options: { stripeAccount?: string } = {},
  ): Promise<void> {
    await this.stripe.paymentIntents.capture(
      providerRef,
      { amount_to_capture: amount },
      options.stripeAccount
        ? { stripeAccount: options.stripeAccount }
        : undefined,
    );
  }

  public async voidPayment(
    providerRef: string,
    options: { stripeAccount?: string } = {},
  ): Promise<void> {
    await this.stripe.paymentIntents.cancel(
      providerRef,
      undefined,
      options.stripeAccount
        ? { stripeAccount: options.stripeAccount }
        : undefined,
    );
  }

  public async refundPayment(
    providerRef: string,
    amount: number,
    options: { stripeAccount?: string } = {},
  ): Promise<RefundResult> {
    const refund = await this.stripe.refunds.create(
      { payment_intent: providerRef, amount },
      options.stripeAccount
        ? { stripeAccount: options.stripeAccount }
        : undefined,
    );
    return { providerRef: refund.id };
  }

  public async parseWebhook(request: Request): Promise<WebhookEvent> {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      throw new AlephaError("Missing stripe-signature header");
    }
    const event = this.stripe.webhooks.constructEvent(
      body,
      signature,
      this.env.STRIPE_WEBHOOK_SECRET,
    );

    const statusMap: Record<string, string> = {
      "payment_intent.succeeded": "captured",
      "payment_intent.amount_capturable_updated": "authorized",
      "payment_intent.payment_failed": "failed",
      "payment_intent.canceled": "failed",
    };

    const status = statusMap[event.type] ?? event.type;
    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    return {
      providerRef: paymentIntent.id,
      status,
      raw: event,
    };
  }

  public async createPaymentMethod(
    userId: string,
    token: string,
  ): Promise<CreatePaymentMethodResult> {
    const customerId = await this.getOrCreateCustomer(userId);
    const pm = await this.stripe.paymentMethods.attach(token, {
      customer: customerId,
    });

    return {
      providerRef: pm.id,
      type: pm.type,
      brand: pm.card?.brand,
      last4: pm.card?.last4,
      expMonth: pm.card?.exp_month,
      expYear: pm.card?.exp_year,
    };
  }

  public async deletePaymentMethod(providerRef: string): Promise<void> {
    await this.stripe.paymentMethods.detach(providerRef);
  }

  public async createConnectAccount(opts: {
    country?: string;
    email?: string;
  }): Promise<{ id: string }> {
    const account = await this.stripe.accounts.create({
      type: "express",
      country: opts.country ?? "FR",
      email: opts.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    return { id: account.id };
  }

  public async createAccountOnboardingLink(opts: {
    account: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const link = await this.stripe.accountLinks.create({
      account: opts.account,
      refresh_url: opts.refreshUrl,
      return_url: opts.returnUrl,
      type: "account_onboarding",
    });
    return { url: link.url };
  }

  public async getConnectAccountStatus(accountId: string): Promise<{
    detailsSubmitted: boolean;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
  }> {
    const account = await this.stripe.accounts.retrieve(accountId);
    return {
      detailsSubmitted: account.details_submitted ?? false,
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
    };
  }

  public async createCheckoutSubscription(opts: {
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string;
    customerId?: string;
    metadata?: Record<string, string>;
  }): Promise<{ url: string; sessionId: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: opts.priceId, quantity: 1 }],
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      customer: opts.customerId,
      customer_email: opts.customerId ? undefined : opts.customerEmail,
      metadata: opts.metadata,
      subscription_data: opts.metadata
        ? { metadata: opts.metadata }
        : undefined,
    });
    if (!session.url)
      throw new Error("Stripe Checkout session created without url");
    return { url: session.url, sessionId: session.id };
  }

  public async retrieveSubscription(
    subscriptionId: string,
  ): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.retrieve(subscriptionId);
  }

  public async cancelSubscription(
    subscriptionId: string,
    opts: { atPeriodEnd?: boolean } = {},
  ): Promise<Stripe.Subscription> {
    if (opts.atPeriodEnd === false) {
      return this.stripe.subscriptions.cancel(subscriptionId);
    }
    return this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
  }

  public async createBillingPortalSession(opts: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: opts.customerId,
      return_url: opts.returnUrl,
    });
    return { url: session.url };
  }

  /**
   * Verify + construct a Stripe webhook event using the platform-level
   * webhook secret (STRIPE_WEBHOOK_SECRET). Distinct from the Connect
   * webhook secret used in StripeConnectWebhookController.
   */
  public constructPlatformEvent(
    rawBody: string,
    signature: string,
  ): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.env.STRIPE_WEBHOOK_SECRET,
    );
  }

  public async expireSession(
    providerRef: string,
    options: { stripeAccount?: string } = {},
  ): Promise<void> {
    const requestOptions = options.stripeAccount
      ? { stripeAccount: options.stripeAccount }
      : undefined;
    try {
      const sessions = await this.stripe.checkout.sessions.list(
        { payment_intent: providerRef, limit: 1 },
        requestOptions,
      );
      if (sessions.data.length > 0) {
        await this.stripe.checkout.sessions.expire(
          sessions.data[0].id,
          undefined,
          requestOptions,
        );
      }
    } catch (error) {
      this.log.warn(
        `Failed to expire Stripe session for ${providerRef}`,
        error,
      );
    }
  }
}
