import { $module } from "alepha";

import { $email } from "./primitives/$email.ts";
import { EmailProvider } from "./providers/EmailProvider.ts";
import { MemoryEmailProvider } from "./providers/MemoryEmailProvider.ts";
import { EmailHeaderPolicy } from "./services/EmailHeaderPolicy.ts";
import { EmailTextRenderer } from "./services/EmailTextRenderer.ts";

// Exports
export * from "./errors/EmailError.ts";
export * from "./primitives/$email.ts";
export * from "./providers/EmailProvider.ts";
export * from "./providers/MemoryEmailProvider.ts";
// ⚠️ Both services must be here as well as in `index.ts`. `$email.send()`
// injects the header policy and the notification sender injects the text
// renderer, so a Worker missing them fails to build (a missing export) and
// would fail at runtime even if it did not. This barrel legitimately
// exports LESS than `index.ts` (no Local or Nodemailer provider), which is
// what makes the omission easy to miss.
export * from "./services/EmailHeaderPolicy.ts";
export * from "./services/EmailTextRenderer.ts";

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
  services: [
    EmailProvider,
    MemoryEmailProvider,
    EmailHeaderPolicy,
    EmailTextRenderer,
  ],
  register: (alepha) => {
    alepha.with({
      optional: true,
      provide: EmailProvider,
      use: MemoryEmailProvider,
    });
  },
});
