import { $inject, type Page, t } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $action } from "alepha/server";
import { PaymentAudits } from "../../audits/index.ts";
import { type Payment, payments } from "../entities/payments.ts";
import { StripePaymentService } from "../services/StripePaymentService.ts";

export class PaymentController {
  protected readonly log = $logger();
  protected readonly payments = $repository(payments);
  protected readonly stripeService = $inject(StripePaymentService);
  protected readonly paymentAudits = $inject(PaymentAudits);

  // ─────────────────────────────────────────────────────────────────────────────
  // Stripe Configuration
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get Stripe publishable key for frontend.
   * GET /payments/stripe/config
   */
  getStripeConfig = $action({
    path: "/payments/stripe/config",
    secure: false,
    description: "Get Stripe configuration for frontend",
    schema: {
      response: t.object({
        publishableKey: t.text(),
      }),
    },
    handler: async () => {
      return {
        publishableKey: this.stripeService.getPublishableKey(),
      };
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Payment Intent Flow
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a Stripe Payment Intent for a booking.
   * POST /payments/create-intent
   *
   * Returns a clientSecret for use with Stripe Elements.
   */
  createPaymentIntent = $action({
    method: "POST",
    path: "/payments/create-intent",
    secure: false,
    description: "Create a Stripe Payment Intent for a booking",
    schema: {
      body: t.object({
        bookingId: t.uuid(),
        bookingReference: t.text(),
        amount: t.integer({
          description: "Amount in smallest currency unit (cents)",
        }),
        currency: t.optional(t.text({ pattern: "^[A-Z]{3}$" })),
        customerEmail: t.email(),
        description: t.optional(t.text()),
      }),
      response: t.object({
        paymentIntentId: t.text(),
        clientSecret: t.text(),
        status: t.text(),
      }),
    },
    handler: async ({ body }) => {
      this.log.info("Creating payment intent", {
        bookingId: body.bookingId,
        bookingReference: body.bookingReference,
        amount: body.amount,
      });

      const result = await this.stripeService.createPaymentIntent({
        bookingId: body.bookingId,
        bookingReference: body.bookingReference,
        amount: body.amount * 100, // Convert to cents
        currency: body.currency ?? "EUR",
        customerEmail: body.customerEmail,
        description:
          body.description ?? `Train booking ${body.bookingReference}`,
      });

      // Audit log
      await this.paymentAudits.audit.logSuccess("create", {
        resourceType: "payment",
        resourceId: result.paymentIntentId,
        userEmail: body.customerEmail,
        description: `Payment intent created for booking ${body.bookingReference}`,
        metadata: {
          bookingId: body.bookingId,
          bookingReference: body.bookingReference,
          amount: body.amount,
          currency: body.currency ?? "EUR",
        },
      });

      return result;
    },
  });

  /**
   * Get payment status by payment intent ID.
   * GET /payments/status/:paymentIntentId
   */
  getPaymentStatus = $action({
    path: "/payments/status/:paymentIntentId",
    secure: false,
    description: "Get payment status from Stripe",
    schema: {
      params: t.object({
        paymentIntentId: t.text(),
      }),
      response: t.object({
        status: t.text(),
        receiptUrl: t.optional(t.text()),
      }),
    },
    handler: async ({ params }) => {
      return await this.stripeService.getPaymentIntentStatus(
        params.paymentIntentId,
      );
    },
  });

  /**
   * Get payment by booking reference.
   * GET /payments/booking/:reference
   */
  getPaymentByBookingReference = $action({
    path: "/payments/booking/:reference",
    secure: false,
    description: "Get payment details by booking reference",
    schema: {
      params: t.object({
        reference: t.text(),
      }),
      response: payments.schema,
    },
    handler: async ({ params }) => {
      return await this.payments.findOne({
        where: { bookingReference: { eq: params.reference } },
      });
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Admin Actions
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Find all payments with pagination and filtering.
   * GET /admin/payments
   */
  findPayments = $action({
    path: "/admin/payments",
    secure: false,
    description: "Find all payments with pagination",
    schema: {
      query: t.object({
        page: t.optional(t.integer({ minimum: 0 })),
        size: t.optional(t.integer({ minimum: 1, maximum: 100 })),
        query: t.optional(t.text()),
        status: t.optional(
          t.enum([
            "pending",
            "processing",
            "requires_action",
            "completed",
            "failed",
            "canceled",
            "refunded",
            "partially_refunded",
          ]),
        ),
        method: t.optional(
          t.enum([
            "card",
            "paypal",
            "bank_transfer",
            "apple_pay",
            "google_pay",
          ]),
        ),
      }),
      response: t.page(payments.schema),
    },
    handler: async ({ query }) => {
      const page = query.page ?? 0;
      const size = query.size ?? 10;

      this.log.debug("Finding payments", { page, size, query: query.query });

      const where: Record<string, any> = {};

      if (query.status) {
        where.status = { eq: query.status };
      }

      if (query.method) {
        where.method = { eq: query.method };
      }

      if (query.query) {
        where.or = [
          { bookingReference: { ilike: `%${query.query}%` } },
          { payerEmail: { ilike: `%${query.query}%` } },
          { transactionId: { ilike: `%${query.query}%` } },
          { stripePaymentIntentId: { ilike: `%${query.query}%` } },
        ];
      }

      const result = await this.payments.paginate(
        { page, size },
        {
          where: Object.keys(where).length > 0 ? where : undefined,
          orderBy: { column: "createdAt", direction: "desc" },
        },
      );

      return result as Page<Payment>;
    },
  });

  /**
   * Get a payment by ID.
   * GET /admin/payments/:id
   */
  getPayment = $action({
    path: "/admin/payments/:id",
    secure: false,
    description: "Get a payment by ID",
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      response: payments.schema,
    },
    handler: async ({ params }) => {
      this.log.debug("Fetching payment by ID", { id: params.id });
      return await this.payments.findById(params.id);
    },
  });

  /**
   * Update a payment status (admin override).
   * PATCH /admin/payments/:id
   */
  updatePayment = $action({
    method: "PATCH",
    path: "/admin/payments/:id",
    secure: false,
    description: "Update a payment",
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      body: t.object({
        status: t.optional(
          t.enum([
            "pending",
            "processing",
            "requires_action",
            "completed",
            "failed",
            "canceled",
            "refunded",
            "partially_refunded",
          ]),
        ),
        failureReason: t.optional(t.text()),
      }),
      response: payments.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Updating payment", { id: params.id, updates: body });

      const payment = await this.payments.updateById(params.id, body);

      this.log.info("Payment updated", {
        id: payment.id,
        status: payment.status,
      });

      return payment;
    },
  });

  /**
   * Refund a payment via Stripe.
   * POST /admin/payments/:id/refund
   */
  refundPayment = $action({
    method: "POST",
    path: "/admin/payments/:id/refund",
    secure: false,
    description: "Refund a payment",
    schema: {
      params: t.object({
        id: t.uuid(),
      }),
      body: t.object({
        amount: t.optional(
          t.integer({ description: "Partial refund amount in cents" }),
        ),
        reason: t.optional(
          t.enum(["duplicate", "fraudulent", "requested_by_customer"]),
        ),
      }),
      response: t.object({
        payment: payments.schema,
        refund: t.object({
          refundId: t.text(),
          amount: t.integer(),
          status: t.text(),
        }),
      }),
    },
    handler: async ({ params, body }) => {
      this.log.info("Refunding payment", {
        id: params.id,
        amount: body.amount,
        reason: body.reason,
      });

      const payment = await this.payments.findById(params.id);

      if (!payment.stripePaymentIntentId) {
        throw new Error(
          "Cannot refund: No Stripe Payment Intent ID associated with this payment",
        );
      }

      if (payment.status !== "completed") {
        throw new Error(`Cannot refund payment with status: ${payment.status}`);
      }

      const refund = await this.stripeService.refundPayment(
        payment.stripePaymentIntentId,
        body.amount,
        body.reason,
      );

      // Fetch updated payment
      const updatedPayment = await this.payments.findById(params.id);

      this.log.info("Payment refunded", {
        id: updatedPayment.id,
        refundId: refund.refundId,
        refundAmount: refund.amount,
      });

      // Audit log
      await this.paymentAudits.audit.logSuccess("refund", {
        severity: "warning",
        resourceType: "payment",
        resourceId: payment.id,
        description: `Payment ${payment.id} refunded (${refund.amount / 100} ${payment.currency})`,
        metadata: {
          bookingReference: payment.bookingReference,
          refundId: refund.refundId,
          refundAmount: refund.amount,
          originalAmount: payment.amount,
          reason: body.reason,
          isPartialRefund: body.amount !== undefined,
        },
      });

      return {
        payment: updatedPayment,
        refund,
      };
    },
  });

  /**
   * Get payments for a specific booking.
   * GET /admin/bookings/:bookingId/payments
   */
  getBookingPayments = $action({
    path: "/admin/bookings/:bookingId/payments",
    secure: false,
    description: "Get all payments for a booking",
    schema: {
      params: t.object({
        bookingId: t.uuid(),
      }),
      response: t.array(payments.schema),
    },
    handler: async ({ params }) => {
      this.log.debug("Fetching payments for booking", {
        bookingId: params.bookingId,
      });

      const result = await this.payments.findMany({
        where: { bookingId: { eq: params.bookingId } },
        orderBy: { column: "createdAt", direction: "desc" },
      });

      return result;
    },
  });
}
