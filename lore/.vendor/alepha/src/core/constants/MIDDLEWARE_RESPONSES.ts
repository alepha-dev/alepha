/**
 * Well-known `meta` key: the HTTP statuses this middleware may answer with
 * instead of letting the handler run.
 *
 * The value is a comma-separated list of statuses (`"401,403"`), since `meta`
 * is a flat `Record<string, string>` by design. `$secure` sets `"401"`, or
 * `"401,403"` when it is given roles or permissions; `$rateLimit` sets `"429"`.
 * A middleware of your own documents its responses the same way.
 *
 * The OpenAPI generator reads it to document the framework responses of a
 * strict `$action` (one declaring `errors`). Consumers read the key, never the
 * middleware's name; see {@link MIDDLEWARE_PROTECTED}.
 */
export const MIDDLEWARE_RESPONSES = "responses";
