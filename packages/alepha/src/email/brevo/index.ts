import { $module, type Alepha } from "alepha";
import { AlephaEmail, EmailProvider } from "alepha/email";
import { BrevoEmailProvider } from "./providers/BrevoEmailProvider.ts";

// Exports
export * from "./providers/BrevoEmailProvider.ts";

/**
 * Plugin for Alepha Email that provides Brevo transactional email capabilities.
 *
 * @see {@link BrevoEmailProvider}
 * @module alepha.email.brevo
 */
export const AlephaEmailBrevo = $module({
  name: "alepha.email.brevo",
  services: [BrevoEmailProvider],
  register: (alepha: Alepha) =>
    alepha
      .with({
        optional: true,
        provide: EmailProvider,
        use: BrevoEmailProvider,
      })
      .with(AlephaEmail),
});
