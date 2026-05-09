import {
  CaptureMethod,
  createMollieClient,
  type MollieClient,
  PaymentStatus,
} from "@mollie/api-client";
import { $env, $inject, Alepha, AlephaError, type Static, t } from "alepha";
import {
  type CreatePaymentMethodResult,
  type CreateSessionResult,
  PaymentError,
  type PaymentIntentEntity,
  type PaymentProvider,
  type RefundResult,
  type WebhookEvent,
} from "alepha/api/payments";
import { $logger } from "alepha/logger";

const envSchema = t.object({
  MOLLIE_API_KEY: t.string(),
  /**
   * Public URL Mollie will POST webhooks to. Mollie webhooks are
   * configured per-payment, so this URL is attached to every payment
   * we create. Typically `https://app.example.com/api/payments/webhook`.
   *
   * Optional: when omitted (e.g. local dev without a tunnel), payments
   * are created without a webhook and status updates rely on the
   * return-from-checkout fetch only.
   */
  MOLLIE_WEBHOOK_URL: t.optional(t.string()),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

/**
 * Maps Mollie's payment status to our internal webhook event status.
 * Returns null for transient states we ignore (open, pending, canceled
 * with no intent — the user simply abandoned the checkout).
 */
const mapStatus = (
  status: PaymentStatus,
): "authorized" | "captured" | "failed" | null => {
  switch (status) {
    case PaymentStatus.paid:
      return "captured";
    case PaymentStatus.authorized:
      return "authorized";
    case PaymentStatus.failed:
    case PaymentStatus.expired:
    case PaymentStatus.canceled:
      return "failed";
    default:
      return null;
  }
};

/**
 * Convert integer minor units (cents) to Mollie's decimal-string format.
 * Alepha stores all amounts as integers; Mollie's API wants strings like
 * "10.00". We assume two-decimal currencies — JPY/KRW would need a table.
 */
const toMollieAmount = (cents: number, currency: string) => ({
  value: (cents / 100).toFixed(2),
  currency: currency.toUpperCase(),
});

export class MolliePaymentProvider implements PaymentProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly env = $env(envSchema);
  protected readonly mollie: MollieClient;

  constructor() {
    this.mollie = createMollieClient({ apiKey: this.env.MOLLIE_API_KEY });
  }

  public async createSession(
    intent: PaymentIntentEntity,
    options: { returnUrl: string; authorize?: boolean },
  ): Promise<CreateSessionResult> {
    const payment = await this.mollie.payments.create({
      amount: toMollieAmount(intent.amount, intent.currency),
      description: `Payment ${intent.id}`,
      redirectUrl: options.returnUrl,
      webhookUrl: this.env.MOLLIE_WEBHOOK_URL,
      metadata: { intentId: intent.id },
      captureMode: options.authorize
        ? CaptureMethod.manual
        : CaptureMethod.automatic,
    });

    const url = payment.getCheckoutUrl();
    if (!url) {
      throw new AlephaError("Mollie payment is missing a checkout URL");
    }

    return { url, providerRef: payment.id };
  }

  public async capturePayment(
    providerRef: string,
    amount: number,
  ): Promise<void> {
    const payment = await this.mollie.payments.get(providerRef);
    await this.mollie.paymentCaptures.create({
      paymentId: providerRef,
      amount: toMollieAmount(amount, payment.amount.currency),
    });
  }

  public async voidPayment(providerRef: string): Promise<void> {
    await this.mollie.payments.cancel(providerRef);
  }

  public async refundPayment(
    providerRef: string,
    amount: number,
  ): Promise<RefundResult> {
    const payment = await this.mollie.payments.get(providerRef);
    const refund = await this.mollie.paymentRefunds.create({
      paymentId: providerRef,
      amount: toMollieAmount(amount, payment.amount.currency),
    });
    return { providerRef: refund.id };
  }

  /**
   * Mollie webhooks are URL-secret rather than signature-based.
   *
   * The body carries only `id=tr_xxx` (form-encoded). We re-fetch the
   * payment via the authenticated API client — the fetch itself is the
   * authentication boundary. An attacker can POST a fake id, but the
   * lookup will either miss or return a payment whose state we already
   * trust (because it came from Mollie's API, not the request body).
   *
   * Status mapping handles transient states (open/pending) by surfacing
   * a sentinel that PaymentService silently drops.
   */
  public async parseWebhook(request: Request): Promise<WebhookEvent> {
    const contentType = request.headers.get("content-type") ?? "";
    let id: string | null = null;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const body = await request.text();
      const params = new URLSearchParams(body);
      id = params.get("id");
    } else if (contentType.includes("application/json")) {
      const body = (await request.json()) as { id?: string };
      id = body.id ?? null;
    } else {
      const body = await request.text();
      id = new URLSearchParams(body).get("id");
    }

    if (!id) {
      throw new AlephaError("Mollie webhook missing payment id");
    }

    const payment = await this.mollie.payments.get(id);
    const status = mapStatus(payment.status);
    if (!status) {
      // Transient state — surface a non-mapped status so PaymentService logs and ignores.
      return { providerRef: payment.id, status: payment.status, raw: payment };
    }

    return { providerRef: payment.id, status, raw: payment };
  }

  /**
   * Mollie does not support tokenize-then-attach: a payment method
   * (mandate) is created implicitly when a customer completes a "first"
   * sequenceType payment. Use the checkout flow to set up recurring
   * billing instead of calling this method directly.
   */
  public async createPaymentMethod(
    _userId: string,
    _token: string,
  ): Promise<CreatePaymentMethodResult> {
    throw new PaymentError(
      "Mollie does not support direct payment method tokenization. " +
        "Use the checkout flow with sequenceType='first' to create a mandate.",
    );
  }

  public async deletePaymentMethod(_providerRef: string): Promise<void> {
    // Mollie mandates are tied to customers; without tracking the
    // customer↔mandate relationship locally there's nothing safe to
    // revoke here. No-op — a future iteration can revoke via
    // customers.mandates.revoke once the entity carries a customerId.
    this.log.debug("Mollie deletePaymentMethod is a no-op");
  }

  public async expireSession(providerRef: string): Promise<void> {
    try {
      const payment = await this.mollie.payments.get(providerRef);
      if (payment.status === PaymentStatus.open) {
        await this.mollie.payments.cancel(providerRef);
      }
    } catch (error) {
      this.log.warn(
        `Failed to expire Mollie payment for ${providerRef}`,
        error,
      );
    }
  }
}
