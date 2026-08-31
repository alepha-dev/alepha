/**
 * `bot` | `human`, from a user-agent string.
 *
 * Two buckets, and the second one is the default. **Ambiguity resolves to
 * `human`**, deliberately and in one direction only: a misclassified bot
 * inflates a number, a misclassified human erases a reader. Those are not the
 * same mistake, so the tie never goes to `bot`.
 *
 * What this catches is a bot that *says so*. That is a smaller claim than it
 * sounds, and the numbers that motivated this dimension say why: on the docs
 * app the largest automated population announced nothing at all - one scraper
 * rotating Chrome/131 across Linux, Windows and macOS with near-identical
 * counts, out of Amazon, Alibaba and Huawei ranges. No user-agent test sees
 * that, and none ever will.
 *
 * So `human` here means "did not declare itself a bot", not "verified human".
 * The honest discriminator remains the behavioural one the envelope already
 * carries, and `sigilEnvelope`'s `engagements` field says it plainly: a
 * scraper driving real headless Chrome sends a perfectly ordinary Chrome
 * user-agent and still never scrolls. This dimension is what makes the
 * declared half filterable; engagement is what tells the truth about the rest.
 *
 * Deliberately not a user-agent parsing library, for the same reason
 * {@link sigilDeviceClass} is not one: those carry thousands of patterns to
 * answer a fine-grained question nobody asks of an analytics rollup, and they
 * need updating to stay accurate.
 *
 * Only a client that executes JavaScript ever reaches the proxy, so a plain
 * `curl` or a fetch-only crawler never arrives here to be classified. The
 * patterns below are therefore the ones that *render*: search and AI
 * renderers, link-preview fetchers, and headless automation.
 */
export const sigilTrafficKind = (userAgent: string | undefined): string => {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "human";

  // Checked first, and the reason it exists: `bot` is a substring of ordinary
  // hardware. CUBOT is an Android phone brand, so `CUBOT_X30` would otherwise
  // classify a real person's phone as a crawler - exactly the direction this
  // function is not allowed to be wrong in.
  if (/cubot/.test(ua)) {
    return "human";
  }

  // `bot(?![a-z])` rather than a bare `bot` so the match lands on a word
  // ending: `Googlebot/2.1`, `bingbot`, `GPTBot`, `ClaudeBot`, `Applebot`.
  //
  // The names spelled out after it are the ones carrying no such marker at
  // all, and they are not hypothetical - `GoogleOther` alone was the third
  // most active agent on alepha.dev the week this was written, and matches
  // none of the generic patterns. Each was observed; adding a name here on
  // suspicion is how a reader gets misfiled as a crawler.
  if (
    /bot(?![a-z])|crawl|spider|slurp|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|googleother|google-extended|facebookexternalhit|meta-externalagent|cohere-ai|whatsapp/.test(
      ua,
    )
  ) {
    return "bot";
  }

  return "human";
};
