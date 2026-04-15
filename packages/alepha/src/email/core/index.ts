import { $module } from "alepha";
import { $email } from "./primitives/$email.ts";
import { EmailProvider } from "./providers/EmailProvider.ts";
import { LocalEmailProvider } from "./providers/LocalEmailProvider.ts";
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
      template: string;
      variables: Record<string, unknown>;
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
 * Email delivery with template support.
 *
 * **Features:**
 * - Send emails with templates
 * - Multiple recipients
 * - Local file provider for development
 * - Memory provider for testing
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
    }
  },
});
