import { $inject, z } from "alepha";
import { intentQuerySchema, intentResourceSchema } from "alepha/api/payments";
import { $action } from "alepha/server";

import { ShowcasePayments } from "./ShowcasePayments.ts";

/**
 * Stands in for `AdminPaymentController`.
 *
 * ⚠️ Property names ARE action names and must match the real controller.
 *
 * Only `listIntents` is declared, which is all `<AdminPayments />` calls. The
 * real controller also captures, voids, refunds and records cash; those are
 * deliberately absent rather than stubbed. A fixture that accepts "refund" and
 * silently does nothing is a worse lie here than elsewhere on this site,
 * because money is the one thing a reader might believe actually moved.
 */
export class ShowcasePaymentsController {
  protected readonly payments = $inject(ShowcasePayments);

  public readonly listIntents = $action({
    path: "/admin/payments/intents",
    schema: {
      query: intentQuerySchema,
      response: z.page(intentResourceSchema),
    },
    handler: ({ query }) => this.payments.paginate(query as any),
  });
}
