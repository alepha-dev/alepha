import {
  AlephaError,
  createPrimitive,
  type InstantiableClass,
  KIND,
  Primitive,
} from "alepha";

import type {
  EmailSendOptions,
  EmailSendResult,
} from "../providers/EmailProvider.ts";
import { EmailProvider } from "../providers/EmailProvider.ts";
import { MemoryEmailProvider } from "../providers/MemoryEmailProvider.ts";
import { EmailHeaderPolicy } from "../services/EmailHeaderPolicy.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Declares an email channel for sending mail through the configured provider.
 *
 * The `name` identifies the channel in the `email:sending` / `email:sent`
 * hooks. `send()` takes the full message (`to`, `subject`, `body`, …); which
 * provider delivers it is a module decision (SMTP, Brevo, Cloudflare, or the
 * in-memory provider under test).
 *
 * @example
 * ```typescript
 * class NotificationService {
 *   email = $email({ name: "notifications" });
 *
 *   async welcome(to: string) {
 *     await this.email.send({ to, subject: "Welcome!", body: "<p>Hello</p>" });
 *   }
 * }
 * ```
 */
export const $email = (options: EmailPrimitiveOptions = {}) =>
  createPrimitive(EmailPrimitive, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface EmailPrimitiveOptions {
  name?: string;
  provider?: InstantiableClass<EmailProvider> | "memory";
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Email primitive for sending emails through various providers.
 *
 * The primitive's `name` identifies the channel in the `email:sending` /
 * `email:sent` hooks; it does not select a template — `send()` expects an
 * already-rendered `subject` and `body`.
 *
 * Usage:
 * ```typescript
 * class MyService {
 *   protected readonly welcomeEmail = $email({ name: "welcome" });
 *
 *   async sendWelcome(userEmail: string, userName: string) {
 *     await this.welcomeEmail.send({
 *       to: userEmail,
 *       subject: "Welcome!",
 *       body: `<p>Hello ${userName}!</p>`
 *     });
 *   }
 * }
 * ```
 */
export class EmailPrimitive extends Primitive<EmailPrimitiveOptions> {
  protected readonly provider = this.$provider();
  protected readonly headerPolicy = this.alepha.inject(EmailHeaderPolicy);

  public get name() {
    return this.options.name ?? `${this.config.propertyKey}`;
  }

  /**
   * Send an email using the configured provider.
   *
   * @return the transport's receipt, whose `messageId` identifies the
   * message (not the recipient) for later delivery events.
   */
  public async send(options: EmailSendOptions): Promise<EmailSendResult> {
    // Before the hook, so a refused header never produces an
    // `email:sending` a listener would have to compensate for.
    this.headerPolicy.assertSafe(options.headers);

    await this.alepha.events.emit("email:sending", {
      to: options.to,
      template: this.name,
      provider: this.provider,
      abort: () => {
        throw new AlephaError("Email sending aborted by hook");
      },
    });

    const result = await this.provider.send(options);

    await this.alepha.events.emit("email:sent", {
      to: options.to,
      template: this.name,
      provider: this.provider,
      messageId: result.messageId,
    });

    return result;
  }

  protected $provider(): EmailProvider {
    if (!this.options.provider) {
      return this.alepha.inject(EmailProvider);
    }
    if (this.options.provider === "memory") {
      return this.alepha.inject(MemoryEmailProvider);
    }
    return this.alepha.inject(this.options.provider);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

$email[KIND] = EmailPrimitive;
