import { $module } from "alepha";
import { $email } from "./primitives/$email.ts";
import { EmailProvider } from "./providers/EmailProvider.ts";
import { MemoryEmailProvider } from "./providers/MemoryEmailProvider.ts";

// Exports
export * from "./errors/EmailError.ts";
export * from "./primitives/$email.ts";
export * from "./providers/EmailProvider.ts";
export * from "./providers/MemoryEmailProvider.ts";

/**
 * Email delivery for Cloudflare Workers.
 *
 * Uses Memory provider by default. For production email delivery,
 * add `AlephaEmailBrevo` from `alepha/email/brevo`.
 *
 * @module alepha.email
 */
export const AlephaEmail = $module({
  name: "alepha.email",
  primitives: [$email],
  services: [EmailProvider, MemoryEmailProvider],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: EmailProvider,
      use: MemoryEmailProvider,
    });
  },
});
