import { $inject } from "alepha";
import { PaymentService } from "alepha/api/payments";

import type { CheckoutSessionEntity } from "../entities/checkoutSessions.ts";
import {
  CheckoutPaymentProvider,
  type PaymentCapabilities,
  type PaymentHandoff,
} from "./CheckoutPaymentProvider.ts";

/**
 * Takes payment by sending the browser to the PSP's hosted page.
 *
 * The default, and the reason it is the default: it is the only handoff every
 * PSP supports, it needs no new adapter code, and it keeps the application out
 * of PCI scope and out of the 3-D Secure retry logic. The customer leaves the
 * site for one screen and comes back.
 *
 * An embedded implementation replaces this by substitution:
 *
 * ```ts
 * alepha.with({
 *   provide: CheckoutPaymentProvider,
 *   use: StripeElementsCheckoutPayment,
 * });
 * ```
 */
export class RedirectCheckoutPayment extends CheckoutPaymentProvider {
  protected readonly payments = $inject(PaymentService);

  public capabilities(): PaymentCapabilities {
    return {
      modes: ["redirect"],
      // Deliberately false even though Stripe Checkout *can* collect an
      // address: this provider does not ask it to, because the checkout owns
      // the address so that swapping PSP does not move the address form.
      collectsShippingAddress: false,
      computesTax: false,
    };
  }

  public async start(
    session: CheckoutSessionEntity,
    options: { returnUrl: string; email?: string },
  ): Promise<PaymentHandoff> {
    const intent = await this.payments.createIntent(
      session.grandTotal,
      session.currency,
      { checkoutSessionId: session.id, orderId: session.orderId },
      { userId: session.userId },
    );

    const { url } = await this.payments.createSession(
      intent.id,
      options.returnUrl,
      false,
      session.userId,
      { customerEmail: options.email ?? session.email },
    );

    return { mode: "redirect", url, intentId: intent.id };
  }
}
