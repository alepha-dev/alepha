import { $env, $inject, Alepha, z } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { $logger } from "alepha/logger";
import { $route } from "alepha/server";

import { NotificationIngestService } from "../services/NotificationIngestService.ts";

const envSchema = z.object({
  BREVO_WEBHOOK_SECRET: z
    .text({
      description:
        "Shared secret Brevo must present on its transactional webhook, as ?secret= on the URL you register. Unset means the webhook route refuses every call.",
    })
    .optional(),
});

/**
 * Inbound delivery events from providers that push rather than queue.
 *
 * A root-level `$route`, not an `$action`: a provider posting a webhook has
 * no session and no business under `/api`, which the `$action` dispatcher
 * shadows anyway.
 *
 * SMTP has no equivalent. Nodemailer bounces arrive as mail to the `From`
 * address, out of band, and are deliberately out of scope: parsing DSN mail
 * is a mail client, not a notification layer.
 */
export class NotificationWebhookController {
  protected readonly url: string = "/notifications/webhooks";
  protected readonly env = $env(envSchema);
  protected readonly alepha = $inject(Alepha);
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly ingest = $inject(NotificationIngestService);
  protected readonly log = $logger();

  public readonly brevoWebhook = $route({
    method: "POST",
    path: `${this.url}/brevo`,
    schema: {
      query: z.object({ secret: z.text().optional() }),
      body: z.record(z.text(), z.any()),
      response: z.object({ ok: z.boolean() }),
    },
    handler: async ({ query, body, reply }) => {
      // Verify BEFORE parsing. The body is untrusted input from the open
      // internet, and an unauthenticated caller must not be able to reach
      // the mapper at all, let alone write a suppression.
      if (!this.authorized(query.secret)) {
        reply.status = 401;
        return { ok: false };
      }

      const event = this.ingest.fromBrevo(body as Record<string, any>);
      if (!event) {
        // Brevo sends event types this app does not act on. Ack them: a
        // non-2xx makes Brevo retry something that will never map.
        this.log.debug("Brevo webhook event ignored", {
          event: (body as Record<string, unknown>).event,
        });
        return { ok: true };
      }

      await this.alepha.events.emit("notification:delivery", event);
      return { ok: true };
    },
  });

  /**
   * Constant-time comparison against the configured secret.
   *
   * An unset secret refuses everything rather than accepting everything: a
   * webhook that writes suppressions is not something to leave open because
   * an operator forgot a variable.
   */
  protected authorized(presented?: string): boolean {
    const expected = this.env.BREVO_WEBHOOK_SECRET;
    if (!expected) {
      this.log.warn(
        "Brevo webhook called but BREVO_WEBHOOK_SECRET is not set; refusing.",
      );
      return false;
    }
    if (!presented) {
      return false;
    }
    return this.crypto.equals(presented, expected);
  }
}
