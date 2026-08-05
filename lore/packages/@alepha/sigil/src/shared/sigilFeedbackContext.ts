/**
 * Contract for the page-context metadata the sigil feedback button collects on
 * the host page and carries — via the popup's query string, appended directly
 * onto the sink-provided feedback URL — through to the first-party Lore
 * feedback form, which persists it as the feedback `source`.
 *
 * Two parties share these short query keys and MUST agree on them:
 *
 * 1. The browser feedback button reads `window.location` / `navigator` /
 *    `document` and sets these keys on the popup URL.
 * 2. The Lore feedback page reads these keys back and maps them into the
 *    `feedbackSourceSchema` fields.
 *
 * There used to be a same-origin proxy in between that forwarded only this
 * whitelist onto its redirect; it is gone — the sink now hands out a
 * ready-to-use URL directly, and the button opens it with no server round
 * trip. The whitelist itself stays: it is still what keeps an embedding page
 * from smuggling arbitrary params into the Lore URL, since the server schema
 * (`feedbackSourceSchema`) only ever reads these named fields back.
 *
 * Kept React-free and browser-API-free (pure constants) so either side can
 * import it without pulling the other's globals. Importable via
 * `@alepha/sigil/context`.
 */
export const SIGIL_FEEDBACK_CONTEXT_PARAMS = [
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

export type SigilFeedbackContextParam =
  (typeof SIGIL_FEEDBACK_CONTEXT_PARAMS)[number];

/**
 * Per-key value cap (characters). A defensive backstop so a hostile embedding
 * page can't push a multi-megabyte URL through the popup; the server schema
 * (`feedbackSourceSchema`) enforces the authoritative bounds on persist.
 */
export const SIGIL_FEEDBACK_CONTEXT_MAX_LEN = 2000;
