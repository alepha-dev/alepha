import type { PaymentIntentEntity } from "../entities/paymentIntents.ts";

export interface CreateSessionResult {
  url: string;
  providerRef: string;
}

export interface RefundResult {
  providerRef: string;
}

export interface WebhookEvent {
  providerRef: string;
  /**
   * Secondary reference to try when `providerRef` matches no stored intent.
   * Checkout-session events carry BOTH a session id and a PaymentIntent id,
   * while the stored intent ref is whichever existed at session-creation
   * time (the PI when eager, the session id when the PSP creates the PI
   * lazily — e.g. Stripe Checkout on connected accounts).
   */
  providerRefAlt?: string;
  status: string;
  /**
   * PSP account that emitted the event, when delivered by a
   * connected-accounts endpoint (Stripe: `acct_…` on `connect: true`
   * endpoints). Lets multi-tenant consumers route the event to the right
   * tenant before resolving the intent.
   */
  account?: string;
  raw: unknown;
}

/**
 * What a browser needs to mount the PSP's own card field, rather than being
 * redirected to its hosted page.
 */
export interface ElementSessionResult {
  /** Per-payment secret the PSP's browser SDK confirms against. */
  clientSecret: string;
  /** Browser-safe key for the SDK. Never a secret key. */
  publishableKey: string;
  /**
   * Which SDK the browser should load — `"stripe"`, `"mollie"`, … The front end
   * dispatches on it, so swapping PSP changes no component code.
   */
  provider: string;
}

export interface CreatePaymentMethodResult {
  providerRef: string;
  type: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
}

export abstract class PaymentProvider {
  /**
   * Create a checkout session with the PSP.
   * Returns a URL to redirect the user to, and the PSP's reference ID.
   */
  abstract createSession(
    intent: PaymentIntentEntity,
    options: {
      returnUrl: string;
      authorize?: boolean;
      stripeAccount?: string;
      applicationFeeAmount?: number;
      /** Pre-fill the payer's email on the hosted checkout page. */
      customerEmail?: string;
    },
  ): Promise<CreateSessionResult>;

  /**
   * Create a session the browser can mount a card field against, keeping the
   * payer on the merchant's own domain.
   *
   * **Optional on purpose.** Not every PSP has an embeddable field, and those
   * that do expose incompatible SDKs — Stripe's Payment Element and Mollie's
   * Components share no API. Declaring this as an optional method rather than a
   * required one is what keeps the abstraction honest: a consumer asks whether
   * the installed provider has it, instead of calling something that silently
   * does nothing.
   *
   * A provider that does not implement it is used through
   * {@link createSession} — a redirect, which every PSP supports.
   */
  createElementSession?(
    intent: PaymentIntentEntity,
    options?: { stripeAccount?: string },
  ): Promise<ElementSessionResult>;

  /**
   * Capture a previously authorized payment.
   * Amount can differ from the original authorization (partial capture).
   */
  abstract capturePayment(providerRef: string, amount: number): Promise<void>;

  /**
   * Void/cancel a previously authorized payment before capture.
   */
  abstract voidPayment(providerRef: string): Promise<void>;

  /**
   * Refund a captured payment (partial or full).
   */
  abstract refundPayment(
    providerRef: string,
    amount: number,
    options?: { stripeAccount?: string },
  ): Promise<RefundResult>;

  /**
   * Parse and verify the authenticity of an incoming PSP webhook request.
   *
   * Implementations MUST establish authenticity before returning. Two
   * common strategies, both acceptable:
   *
   * - Signature verification (Stripe, Adyen): verify an HMAC header
   *   against the raw body using a shared secret. Throw if invalid.
   * - Re-fetch (Mollie, legacy webhooks): the body only carries an id;
   *   call back into the PSP API with your authenticated client to
   *   fetch the real resource state. The fetch itself is the auth —
   *   an attacker can POST a fake id but cannot influence the result.
   *
   * Throw an error if authenticity cannot be established. This endpoint
   * has no $secure middleware; provider verification is its only auth.
   */
  abstract parseWebhook(request: Request): Promise<WebhookEvent>;

  /**
   * Store a payment method token with the PSP and return the saved
   * instrument's reference. Implementations that don't support
   * tokenize-then-attach (e.g. Mollie, where mandates are created by
   * making a "first" payment) MAY throw to signal the host app to use
   * the checkout flow with `setup_future_usage`-style options instead.
   */
  abstract createPaymentMethod(
    userId: string,
    token: string,
  ): Promise<CreatePaymentMethodResult>;

  /**
   * Delete a stored payment method from the PSP. Implementations that
   * don't manage payment methods directly MAY no-op.
   */
  abstract deletePaymentMethod(providerRef: string): Promise<void>;

  /**
   * Expire/cancel a checkout session on the PSP side.
   * Called during stale session cleanup.
   */
  abstract expireSession(providerRef: string): Promise<void>;

  /**
   * Ask the PSP for the current status of a session/intent, mapped to the
   * webhook vocabulary. This is the reconciliation path for deployments
   * where webhooks are missing or unreliable (e.g. Mollie without
   * `MOLLIE_WEBHOOK_URL`): a poller can synthesize the transition the
   * webhook never delivered.
   *
   * Non-abstract on purpose: `null` means "this provider cannot be
   * polled", and reconciliation quietly does nothing. Providers SHOULD
   * override it.
   */
  public async retrieveSessionStatus(
    providerRef: string,
  ): Promise<"authorized" | "captured" | "failed" | null> {
    void providerRef;
    return null;
  }
}
