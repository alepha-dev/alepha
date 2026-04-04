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
  status: string;
  raw: unknown;
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
    options: { returnUrl: string; authorize?: boolean },
  ): Promise<CreateSessionResult>;

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
  ): Promise<RefundResult>;

  /**
   * Parse an incoming PSP webhook request into a normalized event.
   */
  abstract parseWebhook(request: Request): Promise<WebhookEvent>;

  /**
   * Store a payment method token with the PSP.
   */
  abstract createPaymentMethod(
    userId: string,
    token: string,
  ): Promise<CreatePaymentMethodResult>;

  /**
   * Delete a stored payment method from the PSP.
   */
  abstract deletePaymentMethod(providerRef: string): Promise<void>;

  /**
   * Expire/cancel a checkout session on the PSP side.
   * Called during stale session cleanup.
   */
  abstract expireSession(providerRef: string): Promise<void>;
}
