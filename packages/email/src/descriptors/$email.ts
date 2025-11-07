import {
  createDescriptor,
  Descriptor,
  type InstantiableClass,
  KIND,
} from "@alepha/core";
import type { EmailSendOptions } from "../providers/EmailProvider.ts";
import { EmailProvider } from "../providers/EmailProvider.ts";
import { MemoryEmailProvider } from "../providers/MemoryEmailProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const $email = (options: EmailDescriptorOptions = {}) =>
  createDescriptor(EmailDescriptor, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface EmailDescriptorOptions {
  name?: string;
  provider?: InstantiableClass<EmailProvider> | "memory";
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Email descriptor for sending emails through various providers.
 *
 * Usage:
 * ```typescript
 * class MyService {
 *   private readonly welcomeEmail = $email({ name: "welcome" });
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
export class EmailDescriptor extends Descriptor<EmailDescriptorOptions> {
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
      variables: {},
      provider: this.provider,
      abort: () => {
        throw new Error("Email sending aborted by hook");
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

$email[KIND] = EmailDescriptor;
