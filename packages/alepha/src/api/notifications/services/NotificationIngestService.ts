import { $hook, $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import type { NotificationDeliveryEvent } from "../schemas/notificationDeliveryEventSchema.ts";
import { NotificationDeliveryService } from "./NotificationDeliveryService.ts";
import { NotificationSuppressionService } from "./NotificationSuppressionService.ts";

/**
 * Turns a transport's delivery events into suppressions.
 *
 * This is the half of the epic that pays for itself: an address that hard
 * bounced is never retried, and a complaint stops everything, so the sending
 * domain's reputation survives contact with a real list.
 *
 * **Replay is a no-op by construction**, without an events table.
 * `suppress()` is find-then-insert and the receipt update sets a status
 * rather than incrementing anything, so the same event twice leaves one
 * suppression and one receipt. `eventId` is carried on the event for an
 * operator reading logs, not for correctness.
 */
export class NotificationIngestService {
  protected readonly alepha = $inject(Alepha);
  protected readonly suppressions = $inject(NotificationSuppressionService);
  protected readonly deliveries = $inject(NotificationDeliveryService);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly log = $logger();

  /**
   * When the provider told us the event happened, or now.
   *
   * Not every provider sends a timestamp on every event, and an empty string
   * reaching a datetime column is a 500 on a webhook: the provider then
   * retries it, forever, for a message that will never map.
   */
  protected occurredAt(value: string | number | null | undefined): string {
    const text = typeof value === "number" ? String(value) : (value ?? "");
    return text.trim() || this.dateTime.now().toISOString();
  }

  /**
   * Write a suppression for the events that mean "stop sending here".
   *
   * ⚠️ **A soft bounce is not a dead address.** Cloudflare marks every
   * `message.bounced` terminal, including the ones that merely exhausted
   * temporary retries; the hard/soft split is `payload.bounce.type`.
   * Suppressing on a soft bounce would quietly delete a working recipient
   * from an app's reach.
   */
  protected readonly onDeliveryEvent = $hook({
    on: "notification:delivery",
    handler: async (event) => {
      const reason = this.reasonFor(event);
      if (!reason) {
        return;
      }

      // The receipt is the only thing that knows which tenant this message
      // belonged to. Without one, suppressing would either be scoped to no
      // tenant (wrong in a multi-tenant app: it would leak across clubs) or
      // guessed. Log and skip instead.
      const receipt = await this.deliveries.findByMessageId(event.messageId);
      if (!receipt) {
        this.log.info("Delivery event has no receipt, not suppressing", {
          provider: event.provider,
          status: event.status,
          eventId: event.eventId,
        });
        return;
      }

      await this.suppressions.suppress({
        organizationId: receipt.organizationId ?? undefined,
        contact: event.contact,
        channel: event.channel,
        reason,
        source: event.provider,
      });

      this.log.info("Contact suppressed by a delivery event", {
        provider: event.provider,
        reason,
        channel: event.channel,
      });
    },
  });

  protected reasonFor(
    event: NotificationDeliveryEvent,
  ): "bounced" | "complained" | undefined {
    if (event.status === "complained") {
      return "complained";
    }
    if (event.status === "bounced" && event.bounce === "hard") {
      return "bounced";
    }
    return undefined;
  }

  /**
   * Recognise Cloudflare's Email Sending events on the shared
   * `cloudflare:queue` hook and republish them in the normalized shape.
   *
   * Returns quietly on anything else: `$job`'s own messages arrive here too,
   * and so would any other queue this Worker consumes.
   */
  protected readonly onCloudflareQueue = $hook({
    on: "cloudflare:queue",
    handler: async (body) => {
      const type = typeof body.type === "string" ? body.type : undefined;
      if (!type?.startsWith("cf.email.sending.")) {
        return;
      }

      const event = this.fromCloudflare(body);
      if (!event) {
        // Queues is at-least-once and the generated handler retries on a
        // throw, so an unparseable body must be logged and acked or it
        // spins to the dead-letter queue. Never swallow it silently: an
        // unseen complaint is worse than a noisy log line.
        this.log.warn("Unparseable Cloudflare email event, acking", { type });
        return;
      }

      await this.alepha.events.emit("notification:delivery", event);
    },
  });

  /**
   * Map Cloudflare's envelope onto {@link NotificationDeliveryEvent}.
   *
   * @see https://developers.cloudflare.com/email-service/
   */
  public fromCloudflare(
    body: Record<string, unknown>,
  ): NotificationDeliveryEvent | undefined {
    const type = typeof body.type === "string" ? body.type : "";
    const payload = body.payload as Record<string, any> | undefined;
    if (!payload?.messageId || !payload?.recipient) {
      return undefined;
    }

    const status = this.cloudflareStatus(type);
    if (!status) {
      return undefined;
    }

    const metadata = body.metadata as Record<string, any> | undefined;
    return {
      provider: "cloudflare",
      eventId: payload.eventId,
      messageId: String(payload.messageId),
      contact: String(payload.recipient),
      channel: "email",
      status,
      bounce: payload.bounce?.type === "hard" ? "hard" : payload.bounce?.type,
      smtpStatusCode: payload.delivery?.smtpStatusCode
        ? String(payload.delivery.smtpStatusCode)
        : undefined,
      raw: body,
      occurredAt: this.occurredAt(metadata?.eventTimestamp),
    };
  }

  protected cloudflareStatus(
    type: string,
  ): NotificationDeliveryEvent["status"] | undefined {
    const suffix = type.replace("cf.email.sending.message.", "");
    const known: Record<string, NotificationDeliveryEvent["status"]> = {
      delivered: "delivered",
      deferred: "deferred",
      bounced: "bounced",
      failed: "failed",
      rejected: "rejected",
      complained: "complained",
    };
    return known[suffix];
  }

  /**
   * Map a Brevo transactional webhook body onto the normalized shape.
   *
   * `hardBounce` and `invalid_email` are both dead addresses; `blocked` is
   * Brevo refusing to send at all, which is a rejection rather than a bounce.
   */
  public fromBrevo(
    body: Record<string, any>,
  ): NotificationDeliveryEvent | undefined {
    const known: Record<
      string,
      { status: NotificationDeliveryEvent["status"]; bounce?: "hard" | "soft" }
    > = {
      delivered: { status: "delivered" },
      hardBounce: { status: "bounced", bounce: "hard" },
      invalid_email: { status: "bounced", bounce: "hard" },
      softBounce: { status: "bounced", bounce: "soft" },
      deferred: { status: "deferred" },
      spam: { status: "complained" },
      blocked: { status: "rejected" },
    };

    const mapped = known[String(body.event ?? "")];
    const messageId = body["message-id"] ?? body.messageId;
    if (!mapped || !messageId || !body.email) {
      return undefined;
    }

    return {
      provider: "brevo",
      eventId: body.id ? String(body.id) : undefined,
      messageId: String(messageId),
      contact: String(body.email),
      channel: "email",
      status: mapped.status,
      bounce: mapped.bounce,
      smtpStatusCode: body.reason ? String(body.reason) : undefined,
      raw: body,
      occurredAt: this.occurredAt(body.date ?? body.ts_event),
    };
  }
}
