import { z } from "alepha";
import { $parameter } from "alepha/api/parameters";

/**
 * Runtime-editable settings for the notification module.
 *
 * Its own service rather than a field on `NotificationJobs`, because both
 * the jobs and the sender need to read it and `NotificationJobs` already
 * injects the sender: hanging the parameter off the jobs would close the
 * cycle.
 *
 * The parameter's `name` is unchanged, so values an operator has already
 * stored survive the move.
 */
export class NotificationSettings {
  public readonly parameter = $parameter({
    name: "api.notifications",
    description: "Notification delivery & retention settings.",
    schema: z.object({
      retentionDays: z
        .integer()
        .min(1)
        .describe(
          "Days to keep notification execution rows before the purge sweep removes them.",
        ),
      receiptRetentionDays: z
        .integer()
        .min(1)
        .describe(
          "Days to keep delivery receipts. Longer than the outbox on purpose: a complaint can arrive weeks after the send, and the outbox row is already gone.",
        ),
      storeRenderedBody: z
        .boolean()
        .describe(
          "Keep the rendered HTML on each receipt. Off by default: 90 days of full HTML for every notification is real bytes, and a fan-out over a roster multiplies it.",
        ),
      maxStoredBodyBytes: z
        .integer()
        .min(0)
        .describe(
          "Cap on a stored body. Anything longer is truncated rather than rejected: a receipt is for an operator to read, not to replay.",
        ),
      maxAttachmentCount: z
        .integer()
        .min(0)
        .describe(
          "Most attachments one notification may carry. Providers have their own caps too: Brevo caps the whole request, Cloudflare caps the message.",
        ),
      maxAttachmentBytes: z
        .integer()
        .min(0)
        .describe(
          "Total attachment bytes one notification may carry, resolved at send time.",
        ),
    }),
    default: {
      retentionDays: 7,
      receiptRetentionDays: 90,
      storeRenderedBody: false,
      maxStoredBodyBytes: 64_000,
      maxAttachmentCount: 10,
      maxAttachmentBytes: 10_000_000,
    },
  });

  public get current() {
    return this.parameter.cachedCurrentContent;
  }
}
