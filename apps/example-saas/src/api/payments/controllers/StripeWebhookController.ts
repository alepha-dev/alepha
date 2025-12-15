import { $inject, t } from "alepha";
import { $logger } from "alepha/logger";
import { $route, BadRequestError } from "alepha/server";
import { StripePaymentService } from "../services/StripePaymentService.ts";

/**
 * Stripe Webhook Controller.
 *
 * Handles incoming webhook events from Stripe for payment status updates.
 *
 * Configure your Stripe webhook endpoint to point to:
 * POST /webhooks/stripe
 *
 * Required events to listen for:
 * - payment_intent.succeeded
 * - payment_intent.payment_failed
 * - payment_intent.processing
 * - payment_intent.requires_action
 * - payment_intent.canceled
 * - charge.succeeded
 * - charge.refunded
 */
export class StripeWebhookController {
  protected readonly log = $logger();
  protected readonly stripeService = $inject(StripePaymentService);

  /**
   * Handle Stripe webhook events.
   *
   * POST /webhooks/stripe
   *
   * IMPORTANT: This endpoint needs raw body access for signature verification.
   * The signature is computed from the raw request body.
   */
  handleWebhook = $route({
    method: "POST",
    path: "/webhooks/stripe",
    schema: {
      body: t.string(),
      response: t.object({
        received: t.optional(t.boolean()),
        error: t.optional(t.string()),
      }),
    },
    handler: async (request) => {
      const signature = request.headers["stripe-signature"];

      if (!signature) {
        this.log.warn("Stripe webhook missing signature header");
        throw new BadRequestError("Missing stripe-signature header");
      }

      // The body is already parsed as string since we specified t.string() schema
      const rawBody = request.body;

      try {
        // Verify webhook signature and parse event
        const event = this.stripeService.verifyWebhookSignature(
          rawBody,
          signature,
        );

        this.log.info("Stripe webhook received", {
          type: event.type,
          id: event.id,
        });

        // Process the event
        await this.stripeService.handleWebhookEvent(event);

        // Acknowledge receipt to Stripe
        return { received: true };
      } catch (error) {
        if (error instanceof Error) {
          this.log.error("Stripe webhook error", {
            message: error.message,
          });

          // Return 400 for signature verification failures
          if (error.message.includes("signature")) {
            request.reply.setStatus(400);
            return { error: "Invalid signature" };
          }
        }

        // Return 500 for processing errors (Stripe will retry)
        request.reply.setStatus(500);
        return { error: "Webhook processing failed" };
      }
    },
  });
}
