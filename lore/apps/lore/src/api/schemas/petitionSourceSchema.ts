import { type Static, t } from "alepha";

/**
 * Provenance of an embedded petition submission.
 *
 * `null`/absent for first-party petitions (the in-app `/c/:id/request` form).
 * When a petition arrives via a sigil-embedded widget the embedding page
 * supplies this block so the campaign owner sees where it came from.
 *
 * ⚠️ SECURITY: every field here is 100% attacker-controlled (the embedding
 * page sets them — the sigil button reads `window.location`, `navigator`,
 * etc. on an arbitrary partner page). They are persisted verbatim and shown
 * to the campaign owner — render them as escaped plain text only, NEVER
 * through markdown / `dangerouslySetInnerHTML`. See folio #12. `consoleTail`
 * is also length-capped (`maxItems`) so an embedding page cannot POST an
 * arbitrarily large array.
 *
 * `sigilId` is optional because the popup-redirect flow deliberately keeps the
 * sigil id server-side (it never reaches the browser), so a browser-built
 * `source` cannot carry it. The page-context fields below are all optional and
 * best-effort — older clients and the first-party form omit them.
 *
 * Shared by the `petitions` entity schema and the `submitPetition` request
 * body so the two cannot drift.
 */
export const petitionSourceSchema = t.object({
  sigilId: t.optional(t.string({ maxLength: 100 })),
  /** Full `location.href` of the embedding page at click time. */
  hostUrl: t.string({ maxLength: 2000 }),
  /** `location.pathname` (+ search) of the embedding page. */
  hostPath: t.string({ maxLength: 2000 }),
  /** `document.title` of the embedding page. */
  title: t.optional(t.string({ maxLength: 500 })),
  /** `document.referrer` — where the visitor arrived from. */
  referrer: t.optional(t.string({ maxLength: 2000 })),
  userAgent: t.string({ maxLength: 1000 }),
  /** `navigator.language` (e.g. "en-US"). */
  language: t.optional(t.string({ maxLength: 35 })),
  /** Viewport size as "WxH" (`innerWidth`x`innerHeight`). */
  viewport: t.optional(t.string({ maxLength: 20 })),
  /** Screen size as "WxH" (`screen.width`x`screen.height`). */
  screen: t.optional(t.string({ maxLength: 20 })),
  /** IANA timezone (e.g. "Europe/Paris"). */
  timezone: t.optional(t.string({ maxLength: 100 })),
  consoleTail: t.optional(
    t.array(t.string({ maxLength: 2000 }), { maxItems: 50 }),
  ),
});

export type PetitionSource = Static<typeof petitionSourceSchema>;
