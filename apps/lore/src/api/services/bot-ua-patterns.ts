/**
 * Shared User-Agent bot patterns for the Sigils ingestion surface.
 *
 * Used by the Blights crash-capture endpoint (`POST /sigils/:id/blights`)
 * and — by design — the future Beacons endpoint (quest #86): a `<script>`
 * embedded on a partner page is fetched by every crawler that renders JS,
 * and those visits would otherwise show up as phantom crashes / beacons.
 *
 * ⚠️ This is a NOISE FILTER, not a security boundary. The `User-Agent`
 * header is fully client-controlled and trivially spoofable — a hostile
 * client just omits or fakes it. The real volume/cost bound is the
 * Cloudflare WAF per-IP rate-limit rule documented in CLAUDE.md
 * ("Sigils ingestion — Cloudflare WAF"). This list only keeps honest
 * crawlers (Googlebot, monitoring probes, headless screenshot services)
 * from polluting a campaign's Blights inbox.
 *
 * Matching is case-insensitive substring/regex against the raw UA string.
 */
export const BOT_UA_PATTERNS: readonly RegExp[] = [
  /bot/i,
  /crawl/i,
  /spider/i,
  /slurp/i,
  /headless/i,
  /phantomjs/i,
  /puppeteer/i,
  /playwright/i,
  /selenium/i,
  /lighthouse/i,
  /pingdom/i,
  /uptimerobot/i,
  /statuscake/i,
  /datadog/i,
  /newrelic/i,
  /gtmetrix/i,
  /facebookexternalhit/i,
  /embedly/i,
  /preview/i,
  /scrapy/i,
  /curl\//i,
  /wget\//i,
  /python-requests/i,
  /go-http-client/i,
  /okhttp/i,
  /axios\//i,
  /node-fetch/i,
];

/**
 * Returns true when the given User-Agent string looks like an automated
 * client (crawler / monitor / headless browser). An empty/missing UA is
 * treated as a bot — a real embedded browser always sends one.
 */
export const isBotUserAgent = (ua: string | undefined | null): boolean => {
  if (!ua || ua.trim() === "") {
    return true;
  }
  return BOT_UA_PATTERNS.some((re) => re.test(ua));
};
