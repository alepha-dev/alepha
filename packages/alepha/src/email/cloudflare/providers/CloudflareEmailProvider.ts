import { $env, $hook, $inject, Alepha, AlephaError, t } from "alepha";
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
 */
const envSchema = t.object({
  EMAIL_FROM: t.text({
    description: "Default sender email address (must be a verified sender)",
  }),
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
  from: string | { address: string; name?: string };
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
    this.log.info("Sending email via Cloudflare", { to, subject });

    const message: CloudflareEmailSendMessage = {
      to: Array.isArray(to) ? to : [to],
      from: this.env.EMAIL_FROM,
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

  protected getBinding(): CloudflareEmailBinding {
    if (!this.binding) {
      throw new AlephaError(
        "Cloudflare Email binding not initialized. Call start() first.",
      );
    }
    return this.binding;
  }
}
