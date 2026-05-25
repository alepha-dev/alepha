import { $module, type Alepha } from "alepha";
import { AlephaEmail, EmailProvider } from "alepha/email";
import { CloudflareEmailProvider } from "./providers/CloudflareEmailProvider.ts";

// Exports
export * from "./providers/CloudflareEmailProvider.ts";

/**
 * Plugin for Alepha Email that sends through Cloudflare's Email Sending API
 * via a Workers binding.
 *
 * @see {@link CloudflareEmailProvider}
 * @module alepha.email.cloudflare
 */
export const AlephaEmailCloudflare = $module({
  name: "alepha.email.cloudflare",
  services: [CloudflareEmailProvider],
  register: (alepha: Alepha) =>
    alepha
      .with({
        optional: true,
        provide: EmailProvider,
        use: CloudflareEmailProvider,
      })
      .with(AlephaEmail),
});
