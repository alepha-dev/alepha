import { $inject, type Page, t } from "alepha";
import { $logger } from "alepha/logger";
import { $action } from "alepha/server";
import { type Payment, payments } from "../entities/payments.ts";
import { Db } from "../providers/Db.ts";

export class PaymentController {
  protected readonly log = $logger();
  protected readonly db = $inject(Db);

  // ─────────────────────────────────────────────────────────────────────────────
  // Public Actions
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new payment for a booking.
   * POST /payments
   */
  createPayment = $action({
    method: "POST",
    path: "/payments",
    secure: false,
    description: "Create a new payment for a booking",
    schema: {
      body: t.object({
        bookingId: t.uuid(),
        bookingReference: t.text(),
        amount: t.number(),
        currency: t.optional(t.text()),
        method: t.enum([
          "card",
          "paypal",
          "bank_transfer",
          "apple_pay",
          "google_pay",
        ]),
        cardLast4: t.optional(t.text()),
        cardBrand: t.optional(t.text()),
        payerEmail: t.email(),
      }),
      response: payments.schema,
    },
    handler: async ({ body }) => {
      // Generate a transaction ID
      const transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      this.log.info("Creating payment", {
        bookingId: body.bookingId,
        bookingReference: body.bookingReference,
        amount: body.amount,
        method: body.method,
      });

      // Simulate payment processing (in real app, this would call payment gateway)
      const payment = await this.db.payments.create({
        ...body,
        currency: body.currency ?? "EUR",
        transactionId,
        status: "completed", // In real app, this would be based on payment gateway response
      });

      this.log.info("Payment created", {
        id: payment.id,
        transactionId: payment.transactionId,
        status: payment.status,
      });

      return payment;
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
          t.enum(["pending", "processing", "completed", "failed", "refunded"]),
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
        ];
      }

      const result = await this.db.payments.paginate(
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
      return await this.db.payments.findById(params.id);
    },
  });

  /**
   * Update a payment status.
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
          t.enum(["pending", "processing", "completed", "failed", "refunded"]),
        ),
        failureReason: t.optional(t.text()),
      }),
      response: payments.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Updating payment", { id: params.id, updates: body });

      const payment = await this.db.payments.updateById(params.id, body);

      this.log.info("Payment updated", {
        id: payment.id,
        status: payment.status,
      });

      return payment;
    },
  });

  /**
   * Refund a payment.
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
        amount: t.optional(t.number()),
      }),
      response: payments.schema,
    },
    handler: async ({ params, body }) => {
      this.log.info("Refunding payment", {
        id: params.id,
        amount: body.amount,
      });

      const payment = await this.db.payments.findById(params.id);

      const refundAmount = body.amount ?? payment.amount;

      const updated = await this.db.payments.updateById(params.id, {
        status: "refunded",
        refundedAt: new Date().toISOString(),
        refundAmount,
      });

      this.log.info("Payment refunded", {
        id: updated.id,
        refundAmount,
      });

      return updated;
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

      const result = await this.db.payments.findMany({
        where: { bookingId: { eq: params.bookingId } },
        orderBy: { column: "createdAt", direction: "desc" },
      });

      return result;
    },
  });
}
