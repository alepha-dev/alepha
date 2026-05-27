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
  // Gate the substitution on `isServerless()` so apps can register this
  // module unconditionally — the build path needs to see the service to
  // emit the wrangler `send_email` binding, but the runtime substitution
  // must only kick in on Workers. Off-Workers we fall through to
  // AlephaEmail's defaults (LocalEmailProvider for dev, MemoryEmailProvider
  // for tests), so `yarn start` / `yarn dev` / e2e keep working without
  // a real binding.
  register: (alepha: Alepha) => {
    if (alepha.isServerless()) {
      alepha.with({
        optional: true,
        provide: EmailProvider,
        use: CloudflareEmailProvider,
      });
    }
    return alepha.with(AlephaEmail);
  },
});
