import type { CheckoutSessionEntity } from "../entities/checkoutSessions.ts";

/**
 * What a payment front-end needs in order to render itself.
 *
 * Two shapes, because there are genuinely two ways to take a card and the
 * difference is not cosmetic — one hands the browser a URL to leave for, the
 * other hands it a secret to mount a field with.
 */
export type PaymentHandoff =
  | {
      mode: "redirect";
      /**
       * Where to send the browser.
       */
      url: string;
      intentId: string;
    }
  | {
      mode: "embedded";
      /**
       * Per-payment secret the PSP's browser SDK confirms against.
       */
      clientSecret: string;
      /**
       * Publishable key for the SDK. Never a secret key.
       */
      publishableKey: string;
      /**
       * Which SDK to load. The browser `<PaymentSlot/>` dispatches on it, so a
       * consumer that swaps PSPs changes no front-end code.
       */
      provider: string;
      intentId: string;
    };

/**
 * Capabilities a payment provider declares.
 *
 * ### Why capabilities are declared rather than assumed
 *
 * The temptation is to widen `PaymentProvider` with everything Stripe can do —
 * line items, shipping-option collection, automatic tax. But those have no
 * Mollie equivalent, so the interface would promise what only one
 * implementation delivers, and Mollie would become a provider in name only.
 * That is the failure this shape exists to avoid: a consumer asks what is
 * supported and adapts, instead of calling something that silently does
 * nothing.
 */
export interface PaymentCapabilities {
  /**
   * Handoff shapes this provider can produce.
   */
  modes: Array<PaymentHandoff["mode"]>;
  /**
   * Whether the PSP can collect the shipping address itself. When false, the
   * checkout must collect it — which is the case this PoC assumes.
   */
  collectsShippingAddress: boolean;
  /**
   * Whether the PSP can compute destination-based tax.
   */
  computesTax: boolean;
}

/**
 * Bridges a checkout session to a payment rail.
 *
 * Sits above `alepha/api/payments` rather than replacing it: that module owns
 * the intent lifecycle, the webhooks and the PSP adapters. This one only knows
 * how to turn "this checkout owes 89,00 €" into something a browser can act on.
 */
export abstract class CheckoutPaymentProvider {
  abstract capabilities(): PaymentCapabilities;

  /**
   * Create whatever the browser needs to take the payment for this session.
   */
  abstract start(
    session: CheckoutSessionEntity,
    options: { returnUrl: string; email?: string },
  ): Promise<PaymentHandoff>;
}
