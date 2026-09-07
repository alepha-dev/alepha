/**
 * The origin the Alepha documentation is served from.
 *
 * ⚠️ **Absolute, and it has to be.** The docs are a different site on a
 * different host: Lore is `lore.alepha.dev`, the docs are `alepha.dev`. A
 * root-relative href resolves against the PAGE's origin, so
 * `/lore/docs/<slug>` written from inside Lore asks Lore for a route it does
 * not serve and 404s - which is feedback #P2142, reported on the one link
 * that fails exactly when the reader is stuck.
 *
 * A constant rather than an env var, deliberately. This is the public
 * address of a published site, not a per-deployment setting: there is one
 * docs site, it is the same one for a local Lore, a preview and production,
 * and pointing a dev build at production docs is right rather than a
 * compromise. An env var would add a knob whose only correct value is this
 * one, and whose wrong value is a 404 nobody notices until a reader clicks.
 */
const DOCS_ORIGIN = "https://alepha.dev";

/**
 * Link to one page of Lore's own documentation (`docs/lore/`), which is
 * served at `alepha.dev/lore/docs/<slug>`.
 *
 * The slug is the file's name with its leading digits and dashes eaten, so
 * `docs/lore/1-guides/5-cloudflare-token.md` is `guides-cloudflare-token`.
 *
 * Every docs link from Lore goes through here. That is the whole point: the
 * bug this replaces is one character of href, invisible in review, and it
 * will look exactly as reasonable the next time somebody writes it.
 */
export const loreDocsUrl = (slug: string): string =>
  `${DOCS_ORIGIN}/lore/docs/${slug}`;
