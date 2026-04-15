import { $module, type Alepha } from "alepha";
import { AlephaEmail, EmailProvider } from "alepha/email";
import { NodemailerEmailProvider } from "./providers/NodemailerEmailProvider.ts";

// Exports
export * from "./providers/NodemailerEmailProvider.ts";

/**
 * Plugin for Alepha Email that provides SMTP capabilities via Nodemailer.
 *
 * @see {@link NodemailerEmailProvider}
 * @module alepha.email.smtp
 */
export const AlephaEmailSmtp = $module({
  name: "alepha.email.smtp",
  services: [NodemailerEmailProvider],
  imports: [AlephaEmail],
  register: (alepha: Alepha) =>
    alepha.with({
      optional: true,
      provide: EmailProvider,
      use: NodemailerEmailProvider,
    }),
});
