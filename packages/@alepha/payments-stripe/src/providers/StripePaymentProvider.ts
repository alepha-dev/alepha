import { $env, $inject, Alepha, type Static, t } from "alepha";
import { $logger } from "alepha/logger";
import type {
  CreatePaymentMethodResult,
  CreateSessionResult,
  PaymentIntentEntity,
  PaymentProvider,
  RefundResult,
  WebhookEvent,
} from "alepha/api/payments";
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

  constructor() {
    this.stripe = new Stripe(this.env.STRIPE_SECRET_KEY);
  }

  public async createSession(
    intent: PaymentIntentEntity,
    options: { returnUrl: string; authorize?: boolean },
  ): Promise<CreateSessionResult> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
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
      payment_intent_data: options.authorize
        ? { capture_method: "manual" }
        : undefined,
      success_url: options.returnUrl,
      cancel_url: options.returnUrl,
      metadata: { intentId: intent.id },
    });

    return {
      url: session.url!,
      providerRef: session.payment_intent as string,
    };
  }

  public async capturePayment(
    providerRef: string,
    amount: number,
  ): Promise<void> {
    await this.stripe.paymentIntents.capture(providerRef, {
      amount_to_capture: amount,
    });
  }

  public async voidPayment(providerRef: string): Promise<void> {
    await this.stripe.paymentIntents.cancel(providerRef);
  }

  public async refundPayment(
    providerRef: string,
    amount: number,
  ): Promise<RefundResult> {
    const refund = await this.stripe.refunds.create({
      payment_intent: providerRef,
      amount,
    });
    return { providerRef: refund.id };
  }

  public async parseWebhook(request: Request): Promise<WebhookEvent> {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature")!;
    const event = this.stripe.webhooks.constructEvent(
      body,
      signature,
      this.env.STRIPE_WEBHOOK_SECRET,
    );

    const statusMap: Record<string, string> = {
      "payment_intent.succeeded": "captured",
      "payment_intent.amount_capturable_updated": "authorized",
      "payment_intent.payment_failed": "failed",
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
    const pm = await this.stripe.paymentMethods.attach(token, {
      customer: userId,
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

  public async expireSession(providerRef: string): Promise<void> {
    try {
      const sessions = await this.stripe.checkout.sessions.list({
        payment_intent: providerRef,
        limit: 1,
      });
      if (sessions.data.length > 0) {
        await this.stripe.checkout.sessions.expire(sessions.data[0].id);
      }
    } catch (error) {
      this.log.warn(
        `Failed to expire Stripe session for ${providerRef}`,
        error,
      );
    }
  }
}
