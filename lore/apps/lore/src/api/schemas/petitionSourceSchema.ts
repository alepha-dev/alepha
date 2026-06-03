import { type Static, t } from "alepha";

/**
 * Provenance of an embedded petition submission.
 *
 * `null`/absent for first-party petitions (the in-app `/c/:id/request` form).
 * When a petition arrives via a sigil-embedded widget the embedding page
 * supplies this block so the campaign owner sees where it came from.
 *
 * ⚠️ SECURITY: `hostUrl`, `hostPath`, `userAgent` and `consoleTail` are 100%
 * attacker-controlled (the embedding page sets them). They are persisted
 * verbatim and shown to the campaign owner — render them as escaped plain
 * text only, NEVER through markdown / `dangerouslySetInnerHTML`. See folio
 * #12. `consoleTail` is also length-capped (`maxItems`) so an embedding page
 * cannot POST an arbitrarily large array.
 *
 * Shared by the `petitions` entity schema and the `submitPetition` request
 * body so the two cannot drift.
 */
export const petitionSourceSchema = t.object({
  sigilId: t.string({ maxLength: 100 }),
  hostUrl: t.string({ maxLength: 2000 }),
  hostPath: t.string({ maxLength: 2000 }),
  userAgent: t.string({ maxLength: 1000 }),
  consoleTail: t.optional(
    t.array(t.string({ maxLength: 2000 }), { maxItems: 50 }),
  ),
});

export type PetitionSource = Static<typeof petitionSourceSchema>;
