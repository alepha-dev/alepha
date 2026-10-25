/**
 * Where Lore's own guides are read: `alepha.dev/lore/docs/<slug>`, the site
 * that documents the framework, Lore and Bay from one repository (#Q2766).
 *
 * ⚠️ **Absolute, and it has to be.** The guides are on a different host than
 * Lore. A root-relative href resolves against the PAGE's origin, so it asks
 * Lore for a route it does not serve and 404s - which is feedback #P2142,
 * reported on the one link that fails exactly when the reader is stuck.
 *
 * They were GitHub files while Lore lived in its own repository (#E72), until
 * the site took them back (#Q2766). A constant rather than an env var,
 * deliberately: there is one copy of the guides, the same for a local Lore, a
 * preview and production.
 */
const DOCS_ROOT = "https://alepha.dev/lore/docs";

/**
 * Every guide Lore links to, by its slug on the site: the file name with its
 * leading digits and dashes eaten, under `guides-`.
 */
const GUIDES = [
  "guides-automations",
  "guides-artifacts",
  "guides-cloudflare-token",
  "guides-project-dashboard",
  "guides-releases",
] as const;

/**
 * Link to one page of Lore's own guides.
 *
 * Every docs link from Lore goes through here. That is the whole point: the
 * bug this replaces is one character of href, invisible in review, and it
 * will look exactly as reasonable the next time somebody writes it. A slug
 * with no guide is a type error rather than a 404.
 */
export const loreDocsUrl = (slug: (typeof GUIDES)[number]): string =>
  `${DOCS_ROOT}/${slug}`;
