import { $atom, $env, $use, type Static, t } from "alepha";
import { $logger } from "alepha/logger";
import { WorkerMailer } from "worker-mailer";
import { EmailError } from "../errors/EmailError.ts";
import type { EmailProvider, EmailSendOptions } from "./EmailProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Environment variables for worker-mailer configuration
 */
const envSchema = t.object({
  EMAIL_HOST: t.optional(
    t.text({
      description: "SMTP server host",
    }),
  ),
  EMAIL_PORT: t.number({
    default: 587,
    description: "SMTP server port (465 or 587, not 25)",
  }),
  EMAIL_USER: t.optional(
    t.text({
      description: "SMTP authentication username",
    }),
  ),
  EMAIL_PASS: t.optional(
    t.text({
      description: "SMTP authentication password",
    }),
  ),
  EMAIL_FROM: t.optional(
    t.text({
      description: "Default from email address",
    }),
  ),
  EMAIL_FROM_NAME: t.optional(
    t.text({
      description: "Default from name",
    }),
  ),
  EMAIL_SECURE: t.boolean({
    default: true,
    description: "Use secure connection (TLS/STARTTLS)",
  }),
  EMAIL_AUTH_TYPE: t.optional(
    t.enum(["plain", "login", "cram-md5"], {
      default: "plain",
      description: "SMTP authentication type",
    }),
  ),
});

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Worker-mailer specific options
 */
export const workermailerEmailOptions = $atom({
  name: "alepha.email.workermailer.options",
  schema: t.object({
    authType: t.optional(
      t.enum(["plain", "login", "cram-md5"], {
        description: "SMTP authentication type (default: plain)",
      }),
    ),
  }),
  default: {},
});

export type WorkermailerEmailProviderOptions = Static<
  typeof workermailerEmailOptions.schema
>;

declare module "alepha" {
  interface State {
    [workermailerEmailOptions.key]: WorkermailerEmailProviderOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Email provider using worker-mailer for Cloudflare Workers.
 *
 * This provider uses Cloudflare's TCP Sockets API to send emails via SMTP,
 * making it suitable for edge runtime environments.
 *
 * Configuration is provided via environment variables:
 * - EMAIL_HOST: SMTP server host
 * - EMAIL_PORT: SMTP server port (default: 587, note: port 25 is blocked)
 * - EMAIL_USER: SMTP authentication username
 * - EMAIL_PASS: SMTP authentication password
 * - EMAIL_FROM: Default from email address
 * - EMAIL_FROM_NAME: Default from name (optional)
 * - EMAIL_SECURE: Use secure connection (default: true)
 * - EMAIL_AUTH_TYPE: Authentication type - plain, login, or cram-md5 (default: plain)
 *
 * @example
 * ```typescript
 * // Configure via environment variables
 * // EMAIL_HOST=smtp.example.com
 * // EMAIL_PORT=587
 * // EMAIL_USER=user@example.com
 * // EMAIL_PASS=secret
 * // EMAIL_FROM=noreply@example.com
 * // EMAIL_FROM_NAME=My App
 * // EMAIL_SECURE=true
 * // EMAIL_AUTH_TYPE=plain
 * ```
 *
 * @see https://github.com/zou-yu/worker-mailer
 */
export class WorkermailerEmailProvider implements EmailProvider {
  protected readonly env = $env(envSchema);
  protected readonly log = $logger();
  protected readonly options = $use(workermailerEmailOptions);

  protected get host(): string {
    const host = this.env.EMAIL_HOST;
    if (!host) {
      throw new EmailError(
        "Email host not configured. Set EMAIL_HOST env var.",
      );
    }
    return host;
  }

  protected get port(): number {
    return this.env.EMAIL_PORT;
  }

  protected get secure(): boolean {
    return this.env.EMAIL_SECURE;
  }

  protected get user(): string | undefined {
    return this.env.EMAIL_USER;
  }

  protected get pass(): string | undefined {
    return this.env.EMAIL_PASS;
  }

  protected get fromAddress(): string {
    const from = this.env.EMAIL_FROM;
    if (!from) {
      throw new EmailError(
        "Email from address not configured. Set EMAIL_FROM env var.",
      );
    }
    return from;
  }

  protected get fromName(): string | undefined {
    return this.env.EMAIL_FROM_NAME;
  }

  protected get authType(): "plain" | "login" | "cram-md5" {
    return this.options.authType ?? this.env.EMAIL_AUTH_TYPE ?? "plain";
  }

  public async send(options: EmailSendOptions): Promise<void> {
    const { to, subject, body } = options;
    this.log.debug("Sending email via worker-mailer", { to, subject });

    const user = this.user;
    const pass = this.pass;

    if (!user || !pass) {
      throw new EmailError(
        "Email credentials not configured. Set EMAIL_USER and EMAIL_PASS env vars.",
      );
    }

    let mailer: WorkerMailer | undefined;

    try {
      mailer = await WorkerMailer.connect({
        credentials: {
          username: user,
          password: pass,
        },
        authType: this.authType,
        host: this.host,
        port: this.port,
        secure: this.secure,
      });

      const recipients = Array.isArray(to) ? to : [to];

      for (const recipient of recipients) {
        await mailer.send({
          from: this.fromName
            ? { name: this.fromName, email: this.fromAddress }
            : { email: this.fromAddress },
          to: { email: recipient },
          subject,
          html: body,
        });

        this.log.info("Email sent successfully", {
          to: recipient,
          subject,
        });
      }
    } catch (error) {
      const message = `Failed to send email via worker-mailer: ${error instanceof Error ? error.message : String(error)}`;
      this.log.error(message, { to, subject });
      throw new EmailError(message, error instanceof Error ? error : undefined);
    } finally {
      if (mailer) {
        try {
          await mailer.close();
        } catch {
          // Ignore close errors
        }
      }
    }
  }
}
