/**
 * Contract for the page-context metadata the sigil feedback button collects on
 * the host page and carries — via the `/sigil/request` popup query string —
 * through to the first-party Lore petition form, which persists it as the
 * petition `source`.
 *
 * Three parties share these short query keys and MUST agree on them:
 *
 * 1. The browser feedback button reads `window.location` / `navigator` /
 *    `document` and sets these keys on the popup URL.
 * 2. The `/sigil/request` proxy forwards ONLY these keys (a strict whitelist)
 *    onto its 302 redirect, so the embedding page cannot smuggle arbitrary
 *    params into the Lore URL.
 * 3. The Lore petition page reads these keys back and maps them into the
 *    `petitionSourceSchema` fields.
 *
 * Kept React-free and browser-API-free (pure constants) so the server proxy
 * can import it without pulling browser globals. Importable via
 * `@alepha/sigil/context`.
 */
export const SIGIL_PETITION_CONTEXT_PARAMS = [
  /** → source.hostUrl   (location.href) */
  "url",
  /** → source.hostPath  (location.pathname + search) */
  "path",
  /** → source.title     (document.title) */
  "title",
  /** → source.referrer  (document.referrer) */
  "ref",
  /** → source.userAgent (navigator.userAgent) */
  "ua",
  /** → source.language  (navigator.language) */
  "lang",
  /** → source.viewport  (innerWidth x innerHeight) */
  "vp",
  /** → source.screen    (screen.width x screen.height) */
  "scr",
  /** → source.timezone  (Intl resolved timeZone) */
  "tz",
] as const;

export type SigilPetitionContextParam =
  (typeof SIGIL_PETITION_CONTEXT_PARAMS)[number];

/**
 * Per-key value cap (characters). A defensive backstop so a hostile embedding
 * page can't push a multi-megabyte URL through the popup; the server schema
 * (`petitionSourceSchema`) enforces the authoritative bounds on persist.
 */
export const SIGIL_PETITION_CONTEXT_MAX_LEN = 2000;
