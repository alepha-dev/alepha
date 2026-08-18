import { $module, z } from "alepha";
import { $email } from "./primitives/$email.ts";
import { EmailProvider } from "./providers/EmailProvider.ts";
import {
  LocalEmailProvider,
  localEmailOptions,
} from "./providers/LocalEmailProvider.ts";
import { MemoryEmailProvider } from "./providers/MemoryEmailProvider.ts";

// Exports
export * from "./errors/EmailError.ts";
export * from "./primitives/$email.ts";
export * from "./providers/EmailProvider.ts";
export * from "./providers/LocalEmailProvider.ts";
export * from "./providers/MemoryEmailProvider.ts";

// Hook declarations
declare module "alepha" {
  interface Hooks {
    "email:sending": {
      to: string | string[];
      /** The channel name (the `$email` primitive's name), not a template id. */
      template: string;
      provider: EmailProvider;
      abort(): void;
    };
    "email:sent": {
      to: string | string[];
      template: string;
      provider: EmailProvider;
    };
  }
}

/**
 * Email delivery over pluggable providers.
 *
 * **Features:**
 * - `$email` declares a named send channel; the name is surfaced to the
 *   `email:sending` / `email:sent` hooks (as their `template` field) for
 *   auditing and interception
 * - Multiple recipients
 * - Local file provider for development
 * - Memory provider for testing
 *
 * There is **no template rendering**: `send()` takes an already-rendered
 * `subject` and `body` — bring your own templating if you need it.
 *
 * For SMTP support, use `AlephaEmailSmtp` from `alepha/email/smtp`.
 * For Brevo support, use `AlephaEmailBrevo` from `alepha/email/brevo`.
 *
 * @module alepha.email
 */
export const AlephaEmail = $module({
  name: "alepha.email",
  primitives: [$email],
  services: [EmailProvider],
  variants: [MemoryEmailProvider, LocalEmailProvider],
  register: (alepha) => {
    if (alepha.isTest()) {
      alepha.with({
        optional: true,
        provide: EmailProvider,
        use: MemoryEmailProvider,
      });
    } else {
      alepha.with({
        optional: true,
        provide: EmailProvider,
        use: LocalEmailProvider,
      });
      // Relocate scratch data out of the bundle when the host asks for it.
      // See DATA_DIR below.
      const env = alepha.parseEnv(dataDirEnvSchema);
      if (env.DATA_DIR) {
        alepha.store.set(localEmailOptions.key, {
          directory: `${env.DATA_DIR}/emails`,
        });
      }
    }
  },
});

// ---------------------------------------------------------------------------------------------------------------------

const dataDirEnvSchema = z.object({
  DATA_DIR: z.text({
    default: "",
    secret: false,
    description:
      "Root directory for local scratch data (emails, sms). Defaults to node_modules/.alepha, which sits inside the deployed bundle — set this to a writable path outside it on any host that unpacks releases read-only.",
  }),
});
