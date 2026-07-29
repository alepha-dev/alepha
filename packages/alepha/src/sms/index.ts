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
      /** The channel name (the `$sms` primitive's name), not a template id. */
      template: string;
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
 * SMS delivery with multiple provider support.
 *
 * **Features:**
 * - Send SMS (pre-rendered message strings — no template rendering)
 * - Multiple recipients
 * - Provider abstraction
 *
 * @module alepha.sms
 */
export const AlephaSms = $module({
  name: "alepha.sms",
  primitives: [$sms],
  services: [SmsProvider, MemorySmsProvider, LocalSmsProvider],
  register: (alepha) => {
    // Mirror AlephaEmail: memory only under test. In production the memory
    // provider would "succeed" by pushing into an in-process array — silent
    // message loss. LocalSmsProvider at least persists what would be sent;
    // real deployments override with an actual provider.
    if (alepha.isTest()) {
      alepha.with({
        optional: true,
        provide: SmsProvider,
        use: MemorySmsProvider,
      });
    } else {
      alepha.with({
        optional: true,
        provide: SmsProvider,
        use: LocalSmsProvider,
      });
    }
  },
});
