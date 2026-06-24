import { $env, $hook, $inject, Alepha, AlephaError, z } from "alepha";
import {
  EmailError,
  type EmailProvider,
  type EmailSendOptions,
} from "alepha/email";
import { $logger } from "alepha/logger";

/**
 * Default Cloudflare Email Sending binding name.
 *
 * Matches the convention used by other Alepha Cloudflare providers
 * (e.g. `KV_CACHE` for {@link CloudflareKVProvider}).
 */
export const SEND_EMAIL_DEFAULT_BINDING = "SEND_EMAIL";

/**
 * Environment variables for Cloudflare email configuration.
 *
 * `EMAIL_FROM` is `optional` at the schema level so the provider can be
 * registered (and constructed) in non-Workers contexts — Node `yarn
 * start`, build-time introspection, etc. — without forcing every dev to
 * set it. `send()` re-checks at call time and throws a clear error if
 * it's missing then.
 */
const envSchema = z.object({
  EMAIL_FROM: z
    .text({
      description:
        "Default sender (a verified sender address). Accepts a bare address or an RFC 5322 display-name form, e.g. `Lore <noreply@lore.alepha.dev>`.",
    })
    .optional(),
});

/**
 * Shape of the Cloudflare Email Sending binding (public beta, 2026-04-16).
 *
 * @see https://developers.cloudflare.com/email-service/
 */
export interface CloudflareEmailBinding {
  send(message: CloudflareEmailSendMessage): Promise<CloudflareEmailSendResult>;
}

export interface CloudflareEmailSendMessage {
  to: string | string[];
  from: string | { email: string; name?: string };
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  reply_to?: string | string[];
  headers?: Record<string, string>;
}

export interface CloudflareEmailSendResult {
  id?: string;
  status?: "queued" | "sent" | "bounced" | string;
}

/**
 * Email provider using Cloudflare's Email Sending API via a Workers binding.
 *
 * Requires the Workers Paid plan and a verified sender address on the
 * `EMAIL_FROM` domain.
 *
 * **Required Cloudflare binding:**
 * - `SEND_EMAIL` — an Email Sending binding in wrangler configuration
 *
 * Configuration is provided via environment variables:
 * - `EMAIL_FROM`: Default sender email address
 *
 * @example
 * ```toml
 * # wrangler.toml
 * [[send_email]]
 * binding = "SEND_EMAIL"
 * ```
 *
 * @example
 * ```typescript
 * // app.ts
 * import { AlephaEmailCloudflare } from "alepha/email/cloudflare";
 *
 * const app = Alepha.create().with(AlephaEmailCloudflare);
 * ```
 */
export class CloudflareEmailProvider implements EmailProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly env = $env(envSchema);
  protected readonly log = $logger();

  protected binding?: CloudflareEmailBinding;

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      // Tolerate boot off-Workers. The provider has to be registered
      // unconditionally so the CF build task can see it and emit the
      // `send_email` binding into wrangler.jsonc — but actually starting
      // on Node (yarn start / yarn dev) would crash because no binding
      // is wired. Treat that as "inert provider": warn, don't throw.
      // `send()` later will surface the real error if it's ever called.
      const cloudflareEnv = this.alepha.get("cloudflare.env") as
        | Record<string, unknown>
        | undefined;
      if (!cloudflareEnv) {
        this.log.warn(
          "Cloudflare Email Sending inert: 'cloudflare.env' not set (not running on Workers).",
        );
        return;
      }

      const binding = cloudflareEnv[SEND_EMAIL_DEFAULT_BINDING] as
        | CloudflareEmailBinding
        | undefined;
      if (!binding) {
        this.log.warn(
          `Cloudflare Email Sending inert: binding '${SEND_EMAIL_DEFAULT_BINDING}' not found in Workers environment.`,
        );
        return;
      }

      this.binding = binding;
      this.log.info("Cloudflare Email Sending OK");
    },
  });

  public async send(options: EmailSendOptions): Promise<void> {
    const { to, subject, body } = options;
    if (!this.env.EMAIL_FROM) {
      throw new EmailError(
        "Cannot send email via Cloudflare: EMAIL_FROM env var is not set.",
      );
    }
    this.log.info("Sending email via Cloudflare", { to, subject });

    const message: CloudflareEmailSendMessage = {
      to: Array.isArray(to) ? to : [to],
      from: this.resolveFrom(this.env.EMAIL_FROM),
      subject,
      html: body,
    };

    try {
      const result = await this.getBinding().send(message);

      if (result?.status === "bounced") {
        throw new EmailError(
          `Cloudflare email bounced (id=${result.id ?? "unknown"})`,
        );
      }

      this.log.info("Email sent successfully via Cloudflare", {
        to,
        subject,
        id: result?.id,
        status: result?.status,
      });
    } catch (error) {
      if (error instanceof EmailError) {
        throw error;
      }
      const status = (error as { status?: number })?.status;
      const message =
        status === 429
          ? `Cloudflare email rate limit hit (429): ${error instanceof Error ? error.message : String(error)}`
          : `Failed to send email via Cloudflare: ${error instanceof Error ? error.message : String(error)}`;
      this.log.error(message, { to, subject });
      throw new EmailError(message, error instanceof Error ? error : undefined);
    }
  }

  /**
   * Map the configured `EMAIL_FROM` to Cloudflare's `from` shape. An RFC 5322
   * display-name form — `Name <addr@host>` (the name may be quoted) — is split
   * into `{ email, name }` so Cloudflare renders the sender's display name
   * (e.g. `Lore <noreply@lore.alepha.dev>` → "Lore"). A bare address is passed
   * through unchanged.
   *
   * The object key is `email` (not `address`) — that is the field the
   * Cloudflare Email Service Workers API expects. Sending `{ address, name }`
   * makes the API reject the message with an opaque "internal error".
   */
  protected resolveFrom(
    value: string,
  ): string | { email: string; name?: string } {
    const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
    if (!match) {
      return value.trim();
    }
    const name = match[1].replace(/^"|"$/g, "").trim();
    const email = match[2].trim();
    return name ? { email, name } : { email };
  }

  protected getBinding(): CloudflareEmailBinding {
    if (!this.binding) {
      throw new AlephaError(
        "Cloudflare Email binding not initialized. Call start() first.",
      );
    }
    return this.binding;
  }
}
