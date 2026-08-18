import { $atom, $env, $hook, $store, type Infer, z } from "alepha";
import {
  EmailError,
  type EmailProvider,
  type EmailSendOptions,
} from "alepha/email";
import { $logger } from "alepha/logger";
import type { Transporter } from "nodemailer";
import nodemailer from "nodemailer";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Environment variables for nodemailer configuration
 */
const envSchema = z.object({
  EMAIL_HOST: z
    .text({
      secret: false,
      description: "SMTP server host",
    })
    .optional(),
  EMAIL_PORT: z
    .number()
    .describe("SMTP server port")
    .meta({ secret: false })
    .default(587),
  EMAIL_USER: z
    .text({
      description: "SMTP authentication username",
    })
    .optional(),
  EMAIL_PASS: z
    .text({
      description: "SMTP authentication password",
    })
    .optional(),
  EMAIL_FROM: z
    .text({
      // On the From header of every mail this app sends.
      secret: false,
      description: "Default from email address",
    })
    .optional(),
  EMAIL_SECURE: z
    .boolean()
    .describe("Use secure connection (TLS)")
    .meta({ secret: false })
    .default(false),
});

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Nodemailer connection pooling and rate limiting options
 */
export const nodemailerEmailOptions = $atom({
  name: "alepha.email.nodemailer.options",
  schema: z.object({
    pool: z.boolean().describe("Enable connection pooling").optional(),
    maxConnections: z
      .number()
      .describe("Maximum number of connections in pool")
      .optional(),
    maxMessages: z
      .number()
      .describe("Maximum messages per connection")
      .optional(),
    rateDelta: z
      .number()
      .describe("Time in milliseconds between message sends")
      .optional(),
    rateLimit: z
      .number()
      .describe("Maximum number of messages per rateDelta")
      .optional(),
  }),
  default: {},
  serverOnly: true,
});

export type NodemailerEmailProviderOptions = Infer<
  typeof nodemailerEmailOptions.schema
>;

declare module "alepha" {
  interface State {
    [nodemailerEmailOptions.key]: NodemailerEmailProviderOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Email provider using Nodemailer for SMTP transport.
 *
 * Configuration is provided via environment variables:
 * - EMAIL_HOST: SMTP server host
 * - EMAIL_PORT: SMTP server port (default: 587)
 * - EMAIL_USER: SMTP authentication username
 * - EMAIL_PASS: SMTP authentication password
 * - EMAIL_FROM: Default from email address
 * - EMAIL_SECURE: Use secure connection (default: false)
 *
 * Advanced pooling/rate limiting options can be configured via atom:
 * @see {@link nodemailerEmailOptions}
 *
 * @example
 * ```typescript
 * // Configure via environment variables
 * // EMAIL_HOST=smtp.example.com
 * // EMAIL_PORT=587
 * // EMAIL_USER=user@example.com
 * // EMAIL_PASS=secret
 * // EMAIL_FROM=noreply@example.com
 *
 * // Optionally configure pooling via atom
 * alepha.store.set(nodemailerEmailOptions, {
 *   pool: true,
 *   maxConnections: 5,
 *   rateLimit: 10,
 * });
 * ```
 */
export class NodemailerEmailProvider implements EmailProvider {
  protected readonly env = $env(envSchema);
  protected readonly log = $logger();
  protected readonly options = $store(nodemailerEmailOptions);
  protected transporter: Transporter | null = null;

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

  protected getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = this.createTransporter();
    }
    return this.transporter;
  }

  public async send(options: EmailSendOptions): Promise<void> {
    const { to, subject, body } = options;
    this.log.debug("Sending email via Nodemailer", { to, subject });

    try {
      const result = await this.getTransporter().sendMail({
        from: this.fromAddress,
        to,
        subject,
        html: body,
      });

      this.log.info("Email sent successfully", {
        to,
        subject,
        messageId: result.messageId,
        response: result.response,
      });
    } catch (error) {
      const message = `Failed to send email via Nodemailer: ${error instanceof Error ? error.message : String(error)}`;
      this.log.error(message, { to, subject });
      throw new EmailError(message, error instanceof Error ? error : undefined);
    }
  }

  /**
   * The SMTP transport configuration derived from env + the options atom.
   *
   * Split out from {@link createTransporter} so it can be asserted without
   * standing up a real transport — otherwise a test that replaces
   * `createTransporter` ends up checking its own copy of this mapping.
   *
   * `auth` is omitted entirely unless BOTH a user and a password are present:
   * passing `{ user: undefined }` makes nodemailer attempt an anonymous LOGIN
   * instead of skipping authentication.
   */
  protected buildTransporterConfig() {
    return {
      host: this.host,
      port: this.port,
      secure: this.secure,
      auth:
        this.user && this.pass
          ? {
              user: this.user,
              pass: this.pass,
            }
          : undefined,
      pool: this.options.pool,
      maxConnections: this.options.maxConnections,
      maxMessages: this.options.maxMessages,
      rateDelta: this.options.rateDelta,
      rateLimit: this.options.rateLimit,
    };
  }

  protected createTransporter(): Transporter {
    const transporterConfig = this.buildTransporterConfig();

    this.log.debug("Creating Nodemailer transporter", {
      host: transporterConfig.host,
      port: transporterConfig.port,
      secure: transporterConfig.secure,
      user: transporterConfig.auth?.user,
      pool: transporterConfig.pool,
    });

    return nodemailer.createTransport(transporterConfig);
  }

  /**
   * Verify the connection to the email server.
   */
  public async verify(): Promise<boolean> {
    try {
      await this.getTransporter().verify();
      this.log.info("Email server connection verified");
      return true;
    } catch (error) {
      this.log.error("Email server connection failed", { error });
      return false;
    }
  }

  /**
   * Close the transporter connection.
   */
  public close(): void {
    if (this.transporter) {
      this.transporter.close();
      this.transporter = null;
    }
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: () => this.verify(),
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: () => this.close(),
  });
}
