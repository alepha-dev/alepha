/**
 * Where Lore's own guides are read: `docs/1-guides/` of the Lore repository,
 * rendered by GitHub.
 *
 * ⚠️ **Absolute, and it has to be.** The guides are on a different host than
 * Lore. A root-relative href resolves against the PAGE's origin, so it asks
 * Lore for a route it does not serve and 404s - which is feedback #P2142,
 * reported on the one link that fails exactly when the reader is stuck.
 *
 * They were served at `alepha.dev/lore/docs/<slug>` until Lore left the Alepha
 * monorepo (#E72); alepha.dev redirects those addresses here. A constant
 * rather than an env var, deliberately: there is one copy of the guides, the
 * same for a local Lore, a preview and production.
 */
const DOCS_ROOT = "https://github.com/alepha-dev/lore/blob/main/docs/1-guides";

/**
 * Every guide Lore links to, by the slug it has always had (the file name
 * with its leading digits and dashes eaten, under `guides-`), to its file.
 */
const GUIDES = {
  "guides-artifacts": "7-artifacts.md",
  "guides-cloudflare-token": "5-cloudflare-token.md",
  "guides-project-dashboard": "8-project-dashboard.md",
  "guides-releases": "8-releases.md",
} as const;

/**
 * Link to one page of Lore's own guides.
 *
 * Every docs link from Lore goes through here. That is the whole point: the
 * bug this replaces is one character of href, invisible in review, and it
 * will look exactly as reasonable the next time somebody writes it. A slug
 * with no guide is a type error rather than a 404.
 */
export const loreDocsUrl = (slug: keyof typeof GUIDES): string =>
  `${DOCS_ROOT}/${GUIDES[slug]}`;
