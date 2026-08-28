import { $env, z } from "alepha";
import {
  EmailError,
  type EmailProvider,
  type EmailSendOptions,
  type EmailSendResult,
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

  public async send(options: EmailSendOptions): Promise<EmailSendResult> {
    const { to, subject, body, text, replyTo, headers, attachments } = options;
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
          // Brevo rejects an explicit null, so every optional field is
          // omitted rather than sent empty. JSON.stringify drops undefined.
          textContent: text,
          replyTo: replyTo ? { email: replyTo } : undefined,
          headers,
          attachment: attachments?.length
            ? attachments.map((file) => ({
                name: file.filename,
                content: this.toBase64(file.content),
              }))
            : undefined,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new EmailError(
          `Brevo API returned ${response.status}: ${errorBody}`,
        );
      }

      // The success body carries the id Brevo assigned, which the delivery
      // receipts match inbound webhook events against. It used to be read on
      // the failure path only and thrown away here.
      const messageId = await this.readMessageId(response);

      this.log.info("Email sent successfully via Brevo", {
        to,
        subject,
        messageId,
      });

      return { messageId };
    } catch (error) {
      if (error instanceof EmailError) {
        throw error;
      }
      const message = `Failed to send email via Brevo: ${error instanceof Error ? error.message : String(error)}`;
      this.log.error(message, { to, subject });
      throw new EmailError(message, error instanceof Error ? error : undefined);
    }
  }

  /**
   * Brevo wants attachment bytes base64'd into the JSON request.
   *
   * Hand-rolled rather than `Buffer`: this provider runs on workerd too.
   * A string payload is encoded as UTF-8 first, so a text attachment does
   * not arrive mangled.
   */
  protected toBase64(content: Uint8Array | string): string {
    const bytes =
      typeof content === "string" ? new TextEncoder().encode(content) : content;
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  /**
   * Read Brevo's `messageId` out of an accepted response.
   *
   * A malformed or empty body is not a send failure: the API already
   * answered 2xx, so the mail is on its way and only the receipt's ability
   * to match a later webhook event is lost. Return undefined rather than
   * throwing, which would make the job retry and send the mail twice.
   */
  protected async readMessageId(
    response: Response,
  ): Promise<string | undefined> {
    try {
      const payload = (await response.json()) as {
        messageId?: string;
        messageIds?: string[];
      };
      return payload?.messageId ?? payload?.messageIds?.[0];
    } catch {
      this.log.warn("Brevo accepted the message but returned no readable id");
      return undefined;
    }
  }
}
