import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import {
  captureIntentSchema,
  intentQuerySchema,
  intentResourceSchema,
  recordCashSchema,
  refundIntentSchema,
} from "../schemas/intentSchemas.ts";
import { refundResourceSchema } from "../schemas/refundSchemas.ts";
import { PaymentService } from "../services/PaymentService.ts";

/**
 * Permissions follow the `admin:<module>:<verb>` convention every other admin
 * controller uses, so a role granting `admin:*` covers this surface too. The
 * legacy `payments:read` / `payments:write` names are kept alongside as
 * aliases so existing roles keep working.
 */
export class AdminPaymentController {
  protected readonly url = "/admin/payments";
  protected readonly group = "admin:payments";
  protected readonly payments = $inject(PaymentService);

  /**
   * List payment intents with pagination and filtering.
   */
  public readonly listIntents = $action({
    path: `${this.url}/intents`,
    group: this.group,
    use: [$secure({ permissions: ["admin:payment:read", "payments:read"] })],
    description: "List payment intents",
    schema: {
      query: intentQuerySchema,
      response: z.page(intentResourceSchema),
    },
    handler: ({ query }) => this.payments.findIntents(query),
  });

  /**
   * Get a payment intent by ID.
   */
  public readonly getIntent = $action({
    path: `${this.url}/intents/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:payment:read", "payments:read"] })],
    description: "Get payment intent details",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: intentResourceSchema,
    },
    handler: ({ params }) => this.payments.getIntent(params.id),
  });

  /**
   * Capture an authorized intent.
   */
  public readonly captureIntent = $action({
    method: "POST",
    path: `${this.url}/intents/:id/capture`,
    group: this.group,
    use: [$secure({ permissions: ["admin:payment:write", "payments:write"] })],
    description: "Capture an authorized payment intent",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: captureIntentSchema,
      response: intentResourceSchema,
    },
    handler: ({ params, body }) =>
      this.payments.capture(params.id, body.amount),
  });

  /**
   * Void an authorized intent.
   */
  public readonly voidIntent = $action({
    method: "POST",
    path: `${this.url}/intents/:id/void`,
    group: this.group,
    use: [$secure({ permissions: ["admin:payment:write", "payments:write"] })],
    description: "Void an authorized payment intent",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: intentResourceSchema,
    },
    handler: ({ params }) => this.payments.void(params.id),
  });

  /**
   * Refund a captured intent.
   */
  public readonly refundIntent = $action({
    method: "POST",
    path: `${this.url}/intents/:id/refund`,
    group: this.group,
    use: [$secure({ permissions: ["admin:payment:write", "payments:write"] })],
    description: "Issue partial or full refund",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: refundIntentSchema,
      response: refundResourceSchema,
    },
    handler: ({ params, body }) =>
      this.payments.refund(params.id, body.amount, body.reason),
  });

  /**
   * Cancel a created intent.
   */
  public readonly cancelIntent = $action({
    method: "POST",
    path: `${this.url}/intents/:id/cancel`,
    group: this.group,
    use: [$secure({ permissions: ["admin:payment:write", "payments:write"] })],
    description: "Cancel a created payment intent",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: intentResourceSchema,
    },
    handler: ({ params }) => this.payments.cancel(params.id),
  });

  /**
   * Record a cash payment.
   */
  public readonly recordCash = $action({
    method: "POST",
    path: `${this.url}/cash`,
    group: this.group,
    use: [$secure({ permissions: ["admin:payment:write", "payments:write"] })],
    description: "Record a cash payment",
    schema: {
      body: recordCashSchema,
      response: intentResourceSchema,
    },
    handler: ({ body }) =>
      this.payments.recordCashPayment(
        body.amount,
        body.currency,
        body.metadata,
      ),
  });

  /**
   * PSP webhook endpoint (not under /admin, no auth — verified by provider).
   */
  public readonly webhook = $action({
    method: "POST",
    path: "/payments/webhook",
    group: this.group,
    description: "PSP webhook endpoint",
    schema: {
      response: okSchema,
    },
    handler: async (request) => {
      await this.payments.handleWebhook(request.raw.web!.req);
      return { ok: true };
    },
  });
}
