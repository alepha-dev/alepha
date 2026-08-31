/**
 * A bare authority: `host`, `host:port`, or an IPv6 literal in brackets.
 *
 * Anchored at both ends on purpose. Everything this rejects - a scheme, a
 * path, a space, a quote - is something a `Host` header should never carry,
 * and the value ends up in an `href` on the sink's own pages.
 */
const AUTHORITY =
  /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/;

/**
 * The longest a DNS name may be. Also the envelope's own cap on this field.
 */
const MAX_LENGTH = 253;

/**
 * Where an app lives, normalized from its own `Host` header.
 *
 * The app's server is the only party that knows this - the browser posts
 * same-origin and the sink sees only the app's outbound request - which is why
 * it is stamped beside `country`, `visitor` and `device` rather than sent by
 * the client.
 *
 * The header itself is not trustworthy in general: it is whatever the inbound
 * request claimed, so a request to an app behind a permissive proxy can carry
 * any host at all. That is bounded here rather than trusted. The value is only
 * ever *displayed*, never used to route, authorize or link anything the sink
 * acts on; and the sink normalizes again on arrival, because a sender holding
 * a sigil token could put anything on the wire regardless of what this does.
 *
 * Port kept, trailing root dot dropped, case folded. An over-long name is
 * refused rather than truncated: a truncated hostname is not a shorter address,
 * it is a different one.
 */
export const sigilHost = (host: string | undefined): string | undefined => {
  // The dot of a fully-qualified `example.com.`, whether it ends the string or
  // sits in front of the port.
  const value = (host ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.(?=:|$)/, "");

  if (!value || value.length > MAX_LENGTH || !AUTHORITY.test(value)) {
    return undefined;
  }
  return value;
};
