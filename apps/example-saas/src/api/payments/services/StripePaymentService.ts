import { $env, t } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import Stripe from "stripe";
import { payments } from "../entities/payments.ts";

export interface CreatePaymentIntentInput {
  bookingId: string;
  bookingReference: string;
  amount: number;
  currency: string;
  customerEmail: string;
  description: string;
  metadata?: Record<string, string>;
}

export interface PaymentIntentResult {
  paymentIntentId: string;
  clientSecret: string;
  status: string;
}

export interface RefundResult {
  refundId: string;
  amount: number;
  status: string;
}

/**
 * Service for Stripe payment operations.
 *
 * Handles:
 * - Creating Payment Intents for train bookings
 * - Processing webhook events from Stripe
 * - Refunding payments
 *
 * @example
 * ```ts
 * const stripe = alepha.inject(StripePaymentService);
 *
 * // Create a payment intent
 * const intent = await stripe.createPaymentIntent({
 *   bookingId: "uuid",
 *   bookingReference: "ABC123",
 *   amount: 4500, // €45.00
 *   currency: "EUR",
 *   customerEmail: "customer@example.com",
 *   description: "Train booking ABC123",
 * });
 *
 * // Client uses intent.clientSecret with Stripe Elements
 * ```
 */
export class StripePaymentService {
  protected readonly log = $logger();
  protected readonly payments = $repository(payments);
  protected readonly stripe: Stripe;
  protected readonly env = $env(
    t.object({
      STRIPE_PUBLISHABLE_KEY: t.string({
        description: "Stripe publishable key (pk_test_... or pk_live_...)",
      }),
      STRIPE_SECRET_KEY: t.string({
        description: "Stripe secret key (sk_test_... or sk_live_...)",
      }),
      STRIPE_WEBHOOK_SECRET: t.string({
        description: "Stripe webhook signing secret (whsec_...)",
      }),
    }),
  );

  constructor() {
    this.stripe = new Stripe(this.env.STRIPE_SECRET_KEY);
  }

  /**
   * Create a Stripe Payment Intent for a booking.
   *
   * The returned clientSecret should be sent to the frontend
   * for use with Stripe Elements to collect card details.
   */
  async createPaymentIntent(
    input: CreatePaymentIntentInput,
  ): Promise<PaymentIntentResult> {
    this.log.info("Creating Stripe payment intent", {
      bookingId: input.bookingId,
      bookingReference: input.bookingReference,
      amount: input.amount,
      currency: input.currency,
    });

    // Create payment intent in Stripe
    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: input.amount,
      currency: input.currency.toLowerCase(),
      receipt_email: input.customerEmail,
      description: input.description,
      metadata: {
        bookingId: input.bookingId,
        bookingReference: input.bookingReference,
        ...input.metadata,
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    // Create payment record in database
    await this.payments.create({
      bookingId: input.bookingId,
      bookingReference: input.bookingReference,
      amount: input.amount,
      currency: input.currency,
      method: "card",
      payerEmail: input.customerEmail,
      stripePaymentIntentId: paymentIntent.id,
      stripeClientSecret: paymentIntent.client_secret ?? undefined,
      status: "pending",
    });

    this.log.info("Payment intent created", {
      paymentIntentId: paymentIntent.id,
      bookingReference: input.bookingReference,
    });

    return {
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret!,
      status: paymentIntent.status,
    };
  }

  /**
   * Retrieve payment intent status from Stripe.
   */
  async getPaymentIntentStatus(
    paymentIntentId: string,
  ): Promise<{ status: string; receiptUrl?: string }> {
    const paymentIntent =
      await this.stripe.paymentIntents.retrieve(paymentIntentId);

    let receiptUrl: string | undefined;
    if (paymentIntent.latest_charge) {
      const charge = await this.stripe.charges.retrieve(
        paymentIntent.latest_charge as string,
      );
      receiptUrl = charge.receipt_url ?? undefined;
    }

    return {
      status: paymentIntent.status,
      receiptUrl,
    };
  }

  /**
   * Process a refund for a payment.
   */
  async refundPayment(
    paymentIntentId: string,
    amount?: number,
    reason?: "duplicate" | "fraudulent" | "requested_by_customer",
  ): Promise<RefundResult> {
    this.log.info("Processing refund", {
      paymentIntentId,
      amount,
      reason,
    });

    const refund = await this.stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount, // If undefined, refunds full amount
      reason,
    });

    // Update payment record
    const payment = await this.payments.findOne({
      where: { stripePaymentIntentId: { eq: paymentIntentId } },
    });

    const isFullRefund = !amount || amount >= payment.amount;

    await this.payments.updateById(payment.id, {
      status: isFullRefund ? "refunded" : "partially_refunded",
      stripeRefundId: refund.id,
      refundedAt: new Date().toISOString(),
      refundAmount: refund.amount,
    });

    this.log.info("Refund processed", {
      refundId: refund.id,
      amount: refund.amount,
      status: refund.status,
    });

    return {
      refundId: refund.id,
      amount: refund.amount,
      status: refund.status ?? "succeeded",
    };
  }

  /**
   * Verify Stripe webhook signature and parse event.
   */
  verifyWebhookSignature(payload: string, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      payload,
      signature,
      this.env.STRIPE_WEBHOOK_SECRET,
    );
  }

  /**
   * Handle Stripe webhook events.
   *
   * Updates payment records based on webhook notifications:
   * - payment_intent.succeeded -> completed
   * - payment_intent.payment_failed -> failed
   * - payment_intent.processing -> processing
   * - payment_intent.requires_action -> requires_action
   * - payment_intent.canceled -> canceled
   * - charge.refunded -> refunded/partially_refunded
   */
  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    this.log.info("Processing Stripe webhook", {
      type: event.type,
      id: event.id,
    });

    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await this.updatePaymentFromIntent(paymentIntent, "completed", event);
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const failureReason =
          paymentIntent.last_payment_error?.message ?? "Payment failed";
        const failureCode = paymentIntent.last_payment_error?.code;
        await this.updatePaymentFromIntent(paymentIntent, "failed", event, {
          failureReason,
          failureCode,
        });
        break;
      }

      case "payment_intent.processing": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await this.updatePaymentFromIntent(paymentIntent, "processing", event);
        break;
      }

      case "payment_intent.requires_action": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await this.updatePaymentFromIntent(
          paymentIntent,
          "requires_action",
          event,
        );
        break;
      }

      case "payment_intent.canceled": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await this.updatePaymentFromIntent(paymentIntent, "canceled", event);
        break;
      }

      case "charge.succeeded": {
        const charge = event.data.object as Stripe.Charge;
        if (charge.payment_intent) {
          const payment = await this.payments.findOne({
            where: {
              stripePaymentIntentId: { eq: charge.payment_intent as string },
            },
          });
          await this.payments.updateById(payment.id, {
            stripeChargeId: charge.id,
            stripeReceiptUrl: charge.receipt_url ?? undefined,
            cardLast4: charge.payment_method_details?.card?.last4,
            cardBrand: charge.payment_method_details?.card?.brand,
            lastWebhookEvent: event.type,
            lastWebhookAt: new Date().toISOString(),
          });
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        if (charge.payment_intent) {
          const payment = await this.payments.findOne({
            where: {
              stripePaymentIntentId: { eq: charge.payment_intent as string },
            },
          });
          const isFullRefund = charge.amount_refunded >= charge.amount;
          await this.payments.updateById(payment.id, {
            status: isFullRefund ? "refunded" : "partially_refunded",
            refundAmount: charge.amount_refunded,
            refundedAt: new Date().toISOString(),
            lastWebhookEvent: event.type,
            lastWebhookAt: new Date().toISOString(),
          });
        }
        break;
      }

      default:
        this.log.debug("Unhandled webhook event type", { type: event.type });
    }
  }

  /**
   * Update payment record from payment intent data.
   */
  protected async updatePaymentFromIntent(
    paymentIntent: Stripe.PaymentIntent,
    status:
      | "completed"
      | "failed"
      | "processing"
      | "requires_action"
      | "canceled",
    event: Stripe.Event,
    extra?: { failureReason?: string; failureCode?: string },
  ): Promise<void> {
    const payment = await this.payments.findOne({
      where: { stripePaymentIntentId: { eq: paymentIntent.id } },
    });

    await this.payments.updateById(payment.id, {
      status,
      stripePaymentMethodId: paymentIntent.payment_method as string | undefined,
      lastWebhookEvent: event.type,
      lastWebhookAt: new Date().toISOString(),
      ...extra,
    });

    this.log.info("Payment status updated", {
      paymentId: payment.id,
      paymentIntentId: paymentIntent.id,
      status,
    });
  }

  /**
   * Get Stripe publishable key for frontend.
   */
  getPublishableKey(): string {
    return this.env.STRIPE_PUBLISHABLE_KEY;
  }
}
