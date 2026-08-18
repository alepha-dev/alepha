import { $env, z } from "alepha";
import {
  EmailError,
  type EmailProvider,
  type EmailSendOptions,
} from "alepha/email";
import { $logger } from "alepha/logger";

/**
 * Environment variables for Brevo configuration.
 */
const envSchema = z.object({
  BREVO_API_KEY: z.text({
    description: "Brevo API key for transactional email",
  }),
  EMAIL_FROM: z.text({
    // On the From header of every mail this app sends.
    secret: false,
    description: "Default sender email address",
  }),
});

/**
 * Email provider using Brevo (formerly Sendinblue) transactional email API.
 *
 * Sends emails via `POST https://api.brevo.com/v3/smtp/email`.
 *
 * Configuration is provided via environment variables:
 * - `BREVO_API_KEY`: Brevo API key
 * - `EMAIL_FROM`: Default sender email address
 *
 * @example
 * ```typescript
 * // .env
 * // BREVO_API_KEY=xkeysib-xxx
 * // EMAIL_FROM=noreply@example.com
 *
 * // app.ts
 * import { AlephaEmailBrevo } from "alepha/email/brevo";
 *
 * const app = Alepha.create().with(AlephaEmailBrevo);
 * ```
 */
export class BrevoEmailProvider implements EmailProvider {
  protected readonly env = $env(envSchema);
  protected readonly log = $logger();

  public async send(options: EmailSendOptions): Promise<void> {
    const { to, subject, body } = options;
    this.log.info("Sending email via Brevo", { to, subject });

    const recipients = Array.isArray(to) ? to : [to];

    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": this.env.BREVO_API_KEY,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender: { email: this.env.EMAIL_FROM },
          to: recipients.map((email) => ({ email })),
          subject,
          htmlContent: body,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new EmailError(`Brevo API returned ${response.status}: ${text}`);
      }

      this.log.info("Email sent successfully via Brevo", {
        to,
        subject,
      });
    } catch (error) {
      if (error instanceof EmailError) {
        throw error;
      }
      const message = `Failed to send email via Brevo: ${error instanceof Error ? error.message : String(error)}`;
      this.log.error(message, { to, subject });
      throw new EmailError(message, error instanceof Error ? error : undefined);
    }
  }
}
