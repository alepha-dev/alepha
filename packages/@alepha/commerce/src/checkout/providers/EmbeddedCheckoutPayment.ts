import { $inject } from "alepha";
import { PaymentService } from "alepha/api/payments";

import { CommerceError } from "../../errors/CommerceError.ts";
import type { CheckoutSessionEntity } from "../entities/checkoutSessions.ts";
import {
  CheckoutPaymentProvider,
  type PaymentCapabilities,
  type PaymentHandoff,
} from "./CheckoutPaymentProvider.ts";

/**
 * Takes payment in a card field hosted on our own page.
 *
 * PSP-agnostic: it asks `alepha/api/payments` for an element session and passes
 * back whatever the installed provider returned, including the `provider` name
 * the browser dispatches on. Nothing about Stripe appears here, which is what
 * makes swapping PSP a configuration change rather than a rewrite of the
 * checkout.
 *
 * Register it in place of the default redirect:
 *
 * ```ts
 * alepha.with({
 *   provide: CheckoutPaymentProvider,
 *   use: EmbeddedCheckoutPayment,
 * });
 * ```
 *
 * ### The cost this carries, stated plainly
 *
 * Keeping the payer on the page does not remove the trip to their bank: 3-D
 * Secure still redirects and comes back, and the return is now ours to handle
 * rather than the PSP's. And the settlement race widens — the browser can die
 * between confirming and the webhook landing — which is why the order is created
 * *before* the handoff and settled *only* by the webhook. The client's success
 * callback is a hint for the UI, never the record.
 */
export class EmbeddedCheckoutPayment extends CheckoutPaymentProvider {
  protected readonly payments = $inject(PaymentService);

  public capabilities(): PaymentCapabilities {
    return {
      modes: ["embedded"],
      // The checkout owns the address and the tax, exactly as in the redirect
      // flow — so that swapping between the two moves no forms.
      collectsShippingAddress: false,
      computesTax: false,
    };
  }

  public async start(session: CheckoutSessionEntity): Promise<PaymentHandoff> {
    if (!this.payments.supportsEmbeddedPayment()) {
      throw new CommerceError(
        "EmbeddedCheckoutPayment is registered but the installed payment provider has no embedded card field. " +
          "Register RedirectCheckoutPayment instead, or install a provider that supports one.",
      );
    }

    const intent = await this.payments.createIntent(
      session.grandTotal,
      session.currency,
      { checkoutSessionId: session.id, orderId: session.orderId },
      { userId: session.userId },
    );

    const element = await this.payments.createElementSession(intent.id);

    return {
      mode: "embedded",
      clientSecret: element.clientSecret,
      publishableKey: element.publishableKey,
      provider: element.provider,
      intentId: intent.id,
    };
  }
}
