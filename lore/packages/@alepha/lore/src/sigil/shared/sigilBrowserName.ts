/**
 * `chrome` | `safari` | `firefox` | `edge` | `other`, from a user-agent string.
 *
 * Five buckets and no more, for the reason {@link sigilDeviceClass} has three:
 * a dimension's cardinality multiplies the rows every other dimension is
 * crossed with, and Analytics Engine samples harder the more rows a window
 * holds. "Chrome 131.0.6778.86" would cost real precision everywhere else to
 * answer a question nobody asks of a documentation site. What is being asked
 * is which engines the page has to work in.
 *
 * Deliberately not a user-agent parsing library, the same call the two
 * classifiers beside this one make: those carry thousands of patterns, need
 * updating to stay accurate, and exist to answer the fine-grained question
 * this is not asking.
 *
 * **Order is the whole implementation.** Every Chromium browser claims to be
 * Chrome, and Chrome claims to be Safari, so the specific names have to be
 * tested before the general ones or everything collapses into one bucket:
 *
 * - Edge sends `Edg/` *and* `Chrome/`.
 * - Chrome sends `Chrome/` *and* `Safari/`.
 * - Safari is the only one of the three that sends `Safari/` without either.
 *
 * An unrecognised or absent UA is `other` rather than a fourth kind of
 * unknown: a bucket that only ever means "the regex missed" adds a row to
 * every chart and tells the reader nothing they can act on. Ambiguity resolves
 * there too, which is the `sigilTrafficKind` rule in its harmless direction -
 * naming a browser wrongly is worse than not naming it.
 */
export const sigilBrowserName = (userAgent: string | undefined): string => {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "other";

  // Both spellings: `Edge/` is the pre-Chromium one, still sent by a long
  // tail of Windows installs, and `Edg/` is the current one.
  if (/edg(e|a|ios)?\//.test(ua)) return "edge";
  if (/firefox\/|fxios\//.test(ua)) return "firefox";
  // After Edge, before Safari. `crios` is Chrome on iOS, which runs WebKit but
  // is Chrome to everyone who has to support it.
  if (/chrome\/|crios\/|chromium\//.test(ua)) return "chrome";
  if (/safari\//.test(ua)) return "safari";

  return "other";
};
