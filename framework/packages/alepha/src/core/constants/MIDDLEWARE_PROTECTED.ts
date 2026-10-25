/**
 * Well-known `meta` key: this middleware gates its handler behind an identity.
 *
 * The value is the string `"true"` — `meta` is a flat `Record<string, string>`
 * so that it survives any transport and stays readable by code that knows
 * nothing about the middleware that set it.
 *
 * `$secure` sets it, and so should any middleware that turns a visitor away for
 * who they are (a session check, a tenant gate, a paywall). Consumers must read
 * the flag, never the middleware's name: that is the whole point of declaring a
 * capability instead of being recognised.
 *
 * Today the router reads it to decide a page's default rendering mode — a
 * guarded page is behind a login wall, so server-rendering its HTML buys no SEO
 * and costs CPU on every request. See `ReactPageProvider.isSSR`.
 *
 * It is a hint about intent, never an authorization decision. Nothing may grant
 * or deny access based on this flag.
 */
export const MIDDLEWARE_PROTECTED = "protected";
