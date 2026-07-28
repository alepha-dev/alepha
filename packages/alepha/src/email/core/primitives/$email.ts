import {
  AlephaError,
  createPrimitive,
  type InstantiableClass,
  KIND,
  Primitive,
} from "alepha";
import type { EmailSendOptions } from "../providers/EmailProvider.ts";
import { EmailProvider } from "../providers/EmailProvider.ts";
import { MemoryEmailProvider } from "../providers/MemoryEmailProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

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

  public get name() {
    return this.options.name ?? `${this.config.propertyKey}`;
  }

  /**
   * Send an email using the configured provider.
   */
  public async send(options: EmailSendOptions): Promise<void> {
    await this.alepha.events.emit("email:sending", {
      to: options.to,
      template: this.name,
      provider: this.provider,
      abort: () => {
        throw new AlephaError("Email sending aborted by hook");
      },
    });

    await this.provider.send(options);

    await this.alepha.events.emit("email:sent", {
      to: options.to,
      template: this.name,
      provider: this.provider,
    });
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
