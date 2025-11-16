import {
  createDescriptor,
  Descriptor,
  type InstantiableClass,
  KIND,
} from "alepha";
import { MemorySmsProvider } from "../providers/MemorySmsProvider.ts";
import type { SmsSendOptions } from "../providers/SmsProvider.ts";
import { SmsProvider } from "../providers/SmsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const $sms = (options: SmsDescriptorOptions = {}) =>
  createDescriptor(SmsDescriptor, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface SmsDescriptorOptions {
  name?: string;
  provider?: InstantiableClass<SmsProvider> | "memory";
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * SMS descriptor for sending SMS messages through various providers.
 *
 * Usage:
 * ```typescript
 * class MyService {
 *   private readonly welcomeSms = $sms({ name: "welcome" });
 *
 *   async sendWelcome(phoneNumber: string, userName: string) {
 *     await this.welcomeSms.send({
 *       to: phoneNumber,
 *       message: `Hello ${userName}! Welcome to our service.`
 *     });
 *   }
 * }
 * ```
 */
export class SmsDescriptor extends Descriptor<SmsDescriptorOptions> {
  protected readonly provider = this.$provider();

  public get name() {
    return this.options.name ?? `${this.config.propertyKey}`;
  }

  /**
   * Send an SMS using the configured provider.
   */
  public async send(options: SmsSendOptions): Promise<void> {
    await this.alepha.events.emit("sms:sending", {
      to: options.to,
      template: this.name,
      variables: {},
      provider: this.provider,
      abort: () => {
        throw new Error("SMS sending aborted by hook");
      },
    });

    await this.provider.send(options);

    await this.alepha.events.emit("sms:sent", {
      to: options.to,
      template: this.name,
      provider: this.provider,
    });
  }

  protected $provider(): SmsProvider {
    if (!this.options.provider) {
      return this.alepha.inject(SmsProvider);
    }
    if (this.options.provider === "memory") {
      return this.alepha.inject(MemorySmsProvider);
    }
    return this.alepha.inject(this.options.provider);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

$sms[KIND] = SmsDescriptor;
