/**
 * Strips the parts of a URL that carry secrets, before it is attached to an
 * error and sent anywhere.
 *
 * Views and vitals have always been scrubbed at the sink — `normalizePath`
 * splits on `?` and `#` before the path reaches a bucket. Errors were not: the
 * browser fills `sourceUrl` from `location.href`, query string intact, and the
 * sink stored it verbatim on both the error group and the blight. So a throw on
 * `/auth/reset-password?token=abc123` shipped the token, and a blight is
 * readable by every project member and survives the retention sweep once it is
 * resolved or forwarded to a quest.
 *
 * The query string is where session tokens, reset tokens, invite codes, search
 * terms and email addresses live. The fragment is where OAuth implicit-flow
 * access tokens live. Neither is ever needed to locate the code that threw,
 * which is what a `sourceUrl` is for.
 *
 * Userinfo (`https://user:pass@host/…`) goes too. Rare in a browser URL, but it
 * is a credential in the one field of an error record that looks safe to log.
 *
 * **This is not a scrubber for `message` or `stack`.** An app can throw
 * anything, so there is no general rule that finds personal data in a free-form
 * string — a validation error reading `Invalid email: someone@example.com`
 * survives this untouched. That exposure is real and belongs to the app; it is
 * documented on {@link sigilEnvelope} rather than papered over with a regex
 * that would catch some cases and quietly miss the rest.
 *
 * Applied at the source in both {@link SigilBrowserProvider} and
 * {@link SigilServerErrors}, so the unscrubbed value never leaves the process
 * that produced it, and again at the sink for anything arriving from an older
 * client.
 */
export const sigilScrubUrl = (url: string): string =>
  url
    .split(/[?#]/)[0]
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1")
    .slice(0, 2000);
