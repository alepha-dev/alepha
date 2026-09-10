import { $module, AlephaError } from "alepha";

/**
 * What `alepha/email/smtp` is under the `workerd` export condition: a module
 * that refuses to register.
 *
 * Nodemailer opens its own sockets through `node:net` and `node:tls`, which a
 * Worker does not have, so SMTP cannot run there at all. This entry is what
 * keeps nodemailer out of a Cloudflare bundle: a server build bundles every
 * `import()` it can see, including one behind an `if (EMAIL_HOST)` that is
 * never true on a Worker.
 *
 * ⚠️ **It throws rather than doing nothing, on purpose.** A Worker that asks
 * for SMTP and silently gets the default provider drops every mail it sends.
 * On a Worker, send through `AlephaEmailCloudflare` (`alepha/email/cloudflare`).
 *
 * @module alepha.email.smtp
 */
export const AlephaEmailSmtp = $module({
  name: "alepha.email.smtp",
  register: () => {
    throw new AlephaError(
      "SMTP is not available on Cloudflare Workers: nodemailer needs node:net and node:tls, which workerd does not provide. Send mail through AlephaEmailCloudflare from 'alepha/email/cloudflare' instead.",
    );
  },
});
