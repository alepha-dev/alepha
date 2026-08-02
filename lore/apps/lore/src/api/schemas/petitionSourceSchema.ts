import { type Infer, z } from "alepha";

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
export const petitionSourceSchema = z.object({
  sigilId: z.string().max(100).optional(),
  /** Full `location.href` of the embedding page at click time. */
  hostUrl: z.string().max(2000),
  /** `location.pathname` (+ search) of the embedding page. */
  hostPath: z.string().max(2000),
  /** `document.title` of the embedding page. */
  title: z.string().max(500).optional(),
  /** `document.referrer` — where the visitor arrived from. */
  referrer: z.string().max(2000).optional(),
  userAgent: z.string().max(1000),
  /** `navigator.language` (e.g. "en-US"). */
  language: z.string().max(35).optional(),
  /** Viewport size as "WxH" (`innerWidth`x`innerHeight`). */
  viewport: z.string().max(20).optional(),
  /** Screen size as "WxH" (`screen.width`x`screen.height`). */
  screen: z.string().max(20).optional(),
  /** IANA timezone (e.g. "Europe/Paris"). */
  timezone: z.string().max(100).optional(),
  consoleTail: z.array(z.string().max(2000)).max(50).optional(),
});

export type PetitionSource = Infer<typeof petitionSourceSchema>;
