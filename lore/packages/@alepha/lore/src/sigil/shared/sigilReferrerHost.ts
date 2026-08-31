/**
 * The host a visit arrived from, or `undefined` when there is nothing worth
 * reporting.
 *
 * **Host only, never the full URL.** A referrer URL carries the referring
 * page's path and query string, and those hold search terms, session tokens
 * and email addresses just as often as {@link sigilScrubUrl}'s inputs do —
 * with the extra property that they describe a *third-party* page, which this
 * app has no standing to record. The host is also the entire answer to the
 * question a referrer is read for ("where did they come from"), and it keeps
 * the dimension's cardinality bounded by the number of sites that link here
 * rather than by the number of URLs on them.
 *
 * **Same-origin referrers are dropped**, which is what makes the number
 * legible: a multi-page app's own host would otherwise dominate every
 * leaderboard, and "they came from us" is not a traffic source. Absent,
 * opaque (`referrer-policy: no-referrer`) and unparseable values are dropped
 * for the same reason they are indistinguishable from each other — the sink
 * folds all of them into one bucket, see `SigilIngestService.absorbViews`.
 *
 * Lowercased so `Example.com` and `example.com` are one row, and `www.` is
 * kept: a site that links from a bare apex and from `www` really is two
 * configurations, and collapsing them here would hide that from whoever is
 * debugging their own redirect.
 */
export const sigilReferrerHost = (
  referrer: string | undefined,
  currentOrigin: string,
): string | undefined => {
  if (!referrer) return undefined;
  let host: string;
  let origin: string;
  try {
    const url = new URL(referrer);
    // A `javascript:` or `data:` referrer has no host. Neither does a
    // relative one, but `new URL` has already rejected that by throwing.
    if (!url.host) return undefined;
    host = url.host.toLowerCase();
    origin = url.origin;
  } catch {
    return undefined;
  }
  if (origin === currentOrigin) return undefined;
  return host.slice(0, 253);
};
