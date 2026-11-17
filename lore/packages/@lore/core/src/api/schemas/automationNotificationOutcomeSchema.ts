import { z } from "alepha";

/**
 * Live transport evidence, separate from the immutable enqueue result.
 */
export const automationNotificationOutcomeSchema = z
  .object({
    node: z.string().max(64),
    channel: z.string().max(255).optional(),
    row: z.integer().min(0).max(49).optional(),
    outboxId: z.uuid(),
    status: z.enum([
      "queued",
      "unknown",
      "sent",
      "delivered",
      "deferred",
      "bounced",
      "complained",
      "failed",
      "rejected",
      "skipped",
    ]),
    lastAttempt: z
      .enum([
        "sent",
        "delivered",
        "deferred",
        "bounced",
        "complained",
        "failed",
        "rejected",
        "skipped",
      ])
      .optional(),
    receiptId: z.uuid().optional(),
    messageId: z.string().max(255).optional(),
    reason: z.enum(["suppressed", "declined", "unavailable"]).optional(),
  })
  .strict();
