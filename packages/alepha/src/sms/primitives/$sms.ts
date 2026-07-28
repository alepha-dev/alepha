import {
  AlephaError,
  createPrimitive,
  type InstantiableClass,
  KIND,
  Primitive,
} from "alepha";
import { MemorySmsProvider } from "../providers/MemorySmsProvider.ts";
import type { SmsSendOptions } from "../providers/SmsProvider.ts";
import { SmsProvider } from "../providers/SmsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const $sms = (options: SmsPrimitiveOptions = {}) =>
  createPrimitive(SmsPrimitive, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface SmsPrimitiveOptions {
  name?: string;
  provider?: InstantiableClass<SmsProvider> | "memory";
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * SMS primitive for sending SMS messages through various providers.
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
export class SmsPrimitive extends Primitive<SmsPrimitiveOptions> {
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
      provider: this.provider,
      abort: () => {
        throw new AlephaError("SMS sending aborted by hook");
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

$sms[KIND] = SmsPrimitive;
