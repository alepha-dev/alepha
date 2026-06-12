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
  /**
   * Signing secret of the `connect: true` webhook endpoint (events emitted
   * BY CONNECTED ACCOUNTS — direct charges, Checkout on a connected
   * account). Distinct from STRIPE_WEBHOOK_SECRET, which signs the
   * platform-account endpoint. Optional: platforms without Connect (or
   * before the endpoint is declared) simply can't parse connect webhooks.
   */
  STRIPE_CONNECT_WEBHOOK_SECRET: t.optional(t.string()),
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
   * Webhook signature verification needs HMAC over the raw body. The default
   * synchronous `constructEvent` relies on Node's synchronous `crypto`, which
   * is absent on Cloudflare Workers / edge (workerd) — it throws there, so the
   * webhook returns 400 and Stripe deliveries fail. A SubtleCrypto provider
   * lets us use the async `constructEventAsync`, which works on both Node and
   * workerd. Created lazily so construction never depends on `crypto.subtle`.
   */
  protected cryptoProvider?: InstanceType<typeof Stripe.CryptoProvider>;

  protected getCryptoProvider(): InstanceType<typeof Stripe.CryptoProvider> {
    if (!this.cryptoProvider) {
      this.cryptoProvider = Stripe.createSubtleCryptoProvider();
    }
    return this.cryptoProvider;
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
      customerEmail?: string;
    },
  ): Promise<CreateSessionResult> {
    // Customer objects live on the PLATFORM account — they don't exist on a
    // connected account, so sessions created there (direct charges) must
    // not reference one. `customer_email` carries the pre-fill instead.
    const customer =
      intent.userId && !options.stripeAccount
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
        // Mutually exclusive with `customer` per Stripe's API.
        customer_email: customer ? undefined : options.customerEmail,
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
    return this.verifyAndMapWebhook(request, this.env.STRIPE_WEBHOOK_SECRET);
  }

  /** Whether the connected-accounts webhook endpoint is configured. */
  public get hasConnectWebhookSecret(): boolean {
    return Boolean(this.env.STRIPE_CONNECT_WEBHOOK_SECRET);
  }

  /**
   * Parse a webhook delivered by the `connect: true` endpoint (events
   * emitted by CONNECTED accounts). Same mapping as `parseWebhook`, but
   * verified with STRIPE_CONNECT_WEBHOOK_SECRET — Stripe signs each
   * endpoint with its own secret. The returned `account` (acct_…) tells a
   * multi-tenant consumer WHICH connected account emitted the event.
   */
  public async parseConnectWebhook(request: Request): Promise<WebhookEvent> {
    const secret = this.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    if (!secret) {
      throw new AlephaError(
        "STRIPE_CONNECT_WEBHOOK_SECRET is not configured — declare the connect webhook endpoint first",
      );
    }
    return this.verifyAndMapWebhook(request, secret);
  }

  protected async verifyAndMapWebhook(
    request: Request,
    secret: string,
  ): Promise<WebhookEvent> {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      throw new AlephaError("Missing stripe-signature header");
    }
    const event = await this.stripe.webhooks.constructEventAsync(
      body,
      signature,
      secret,
      undefined,
      this.getCryptoProvider(),
    );

    const statusMap: Record<string, string> = {
      "payment_intent.succeeded": "captured",
      "payment_intent.amount_capturable_updated": "authorized",
      "payment_intent.payment_failed": "failed",
      "payment_intent.canceled": "failed",
      // Checkout-session events are the only reliable capture signal when
      // the session's PaymentIntent is created lazily (Stripe Checkout on
      // CONNECTED accounts): the stored intent ref is the session id, and
      // `payment_intent.succeeded` alone would never match it.
      "checkout.session.completed": "captured",
      "checkout.session.expired": "failed",
    };

    const status = statusMap[event.type] ?? event.type;
    // Present on events delivered by a `connect: true` endpoint.
    const account = (event as { account?: string }).account;
    const object = event.data.object as { object: string; id: string };

    if (object.object === "checkout.session") {
      const session = event.data.object as Stripe.Checkout.Session;
      return {
        // The stored ref is the PI when it existed at creation, the session
        // id otherwise (lazy PI) — surface both and let the service match.
        providerRef: session.id,
        providerRefAlt:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : undefined,
        status,
        account,
        raw: event,
      };
    }

    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    return {
      providerRef: paymentIntent.id,
      status,
      account,
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

  /**
   * Create a connected account via the **Accounts v2 API**
   * (`POST /v2/core/accounts`) — NOT the legacy `type: "express"` account.
   *
   * The connected account is the merchant of record and bears everything
   * ("we're just software", 0% application fee): it pays Stripe's processing
   * fees (`fees_collector: "stripe"`), is liable for refunds/chargebacks
   * (`losses_collector: "stripe"`), self-collects KYC via Stripe, and gets a
   * full Stripe dashboard (`dashboard: "full"`). It requests the
   * `card_payments` capability so direct charges can be created on it.
   */
  public async createConnectAccount(opts: {
    country?: string;
    email?: string;
    displayName?: string;
  }): Promise<{ id: string }> {
    // FR/EU platforms (PSD2, verified empirically 2026-06-11 on the Stripe
    // sandbox): creating a v2 account WITH a merchant configuration requires
    // the identity-bearing fields to ride a v2 ACCOUNT TOKEN — a direct
    // create fails with `account_token_required` ("Connect platforms based
    // in FR can only update certain identity information on a v2 account
    // with a merchant configuration via account tokens"). The working shape:
    //  - the TOKEN carries contact_email + display_name + entity_type
    //    (assumed "company"; the hosted onboarding re-confirms it);
    //  - `identity.country` is NOT tokenizable (per the account-tokens doc)
    //    and goes DIRECTLY on the create — and it is required for the
    //    entity_type/merchant configuration to apply.
    const token = await this.stripe.v2.core.accountTokens.create({
      contact_email: opts.email,
      display_name: opts.displayName,
      identity: { entity_type: "company" },
    });

    const account = await this.stripe.v2.core.accounts.create({
      account_token: token.id,
      identity: { country: (opts.country ?? "FR").toLowerCase() },
      dashboard: "full",
      defaults: {
        responsibilities: {
          fees_collector: "stripe",
          losses_collector: "stripe",
        },
      },
      configuration: {
        merchant: {
          capabilities: { card_payments: { requested: true } },
        },
      },
      include: ["configuration.merchant", "requirements"],
    });

    return { id: account.id };
  }

  public async createAccountOnboardingLink(opts: {
    account: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const link = await this.stripe.v2.core.accountLinks.create({
      account: opts.account,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["merchant"],
          refresh_url: opts.refreshUrl,
          return_url: opts.returnUrl,
        },
      },
    });
    return { url: link.url };
  }

  public async getConnectAccountStatus(accountId: string): Promise<{
    detailsSubmitted: boolean;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
  }> {
    const account = await this.stripe.v2.core.accounts.retrieve(accountId, {
      include: ["configuration.merchant", "requirements"],
    });
    // v2 has no flat charges_enabled/details_submitted/payouts_enabled — derive
    // from the merchant card_payments capability status.
    const status =
      account.configuration?.merchant?.capabilities?.card_payments?.status;
    const active = status === "active";
    return {
      detailsSubmitted: status != null && status !== "pending",
      chargesEnabled: active,
      payoutsEnabled: active,
    };
  }

  public async createCheckoutSetup(opts: {
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string;
    customerId?: string;
    metadata?: Record<string, string>;
  }): Promise<{ url: string; sessionId: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "setup",
      currency: "eur",
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      customer: opts.customerId,
      customer_email: opts.customerId ? undefined : opts.customerEmail,
      metadata: opts.metadata,
    });
    if (!session.url)
      throw new Error("Stripe Checkout session created without url");
    return { url: session.url, sessionId: session.id };
  }

  public async createCheckoutSubscription(opts: {
    priceId?: string;
    priceData?: {
      currency: string;
      unitAmount: number;
      interval: "month" | "year";
      productName: string;
    };
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string;
    customerId?: string;
    metadata?: Record<string, string>;
  }): Promise<{ url: string; sessionId: string }> {
    const line_items: Stripe.Checkout.SessionCreateParams["line_items"] =
      opts.priceData
        ? [
            {
              quantity: 1,
              price_data: {
                currency: opts.priceData.currency,
                unit_amount: opts.priceData.unitAmount,
                recurring: { interval: opts.priceData.interval },
                product_data: { name: opts.priceData.productName },
              },
            },
          ]
        : [{ price: opts.priceId as string, quantity: 1 }];
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      line_items,
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
  public async constructPlatformEvent(
    rawBody: string,
    signature: string,
  ): Promise<Stripe.Event> {
    return this.stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      this.env.STRIPE_WEBHOOK_SECRET,
      undefined,
      this.getCryptoProvider(),
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
