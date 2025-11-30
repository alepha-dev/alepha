import { $module } from "alepha";
import { $sms } from "./primitives/$sms.ts";
import { LocalSmsProvider } from "./providers/LocalSmsProvider.ts";
import { MemorySmsProvider } from "./providers/MemorySmsProvider.ts";
import { SmsProvider } from "./providers/SmsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/SmsError.ts";
export * from "./primitives/$sms.ts";
export * from "./providers/LocalSmsProvider.ts";
export * from "./providers/MemorySmsProvider.ts";
export * from "./providers/SmsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    "sms:sending": {
      to: string | string[];
      template: string;
      variables: Record<string, unknown>;
      provider: SmsProvider;
      abort(): void;
    };
    "sms:sent": {
      to: string | string[];
      template: string;
      provider: SmsProvider;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides SMS sending capabilities for Alepha applications with multiple provider backends.
 *
 * The SMS module enables declarative SMS sending through the `$sms` primitive, allowing you to send
 * text messages through different providers: memory (for testing) or local file system.
 * It supports automatic provider selection based on environment configuration.
 *
 * @see {@link SmsProvider}
 * @module alepha.sms
 */
export const AlephaSms = $module({
  name: "alepha.sms",
  primitives: [$sms],
  services: [SmsProvider, MemorySmsProvider, LocalSmsProvider],
  register: (alepha) =>
    alepha.with({
      optional: true,
      provide: SmsProvider,
      use: MemorySmsProvider,
    }),
});
