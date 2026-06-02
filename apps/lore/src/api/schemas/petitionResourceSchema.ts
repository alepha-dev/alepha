import { type Static, t } from "alepha";
import { petitions } from "../entities/petitions.ts";

/**
 * Quest stub linked from a petition. Mirrors the subset of `quests` fields the
 * petition status page (reporter-facing) and inbox drawer (owner-facing) need
 * to render quest progression — full quest details live behind their own
 * endpoint.
 */
export const petitionLinkedQuestSchema = t.object({
  id: t.integer(),
  shortId: t.integer(),
  title: t.string(),
  status: t.enum(["new", "accepted", "completed"], { mode: "text" }),
  difficulty: t.integer(),
  priority: t.string(),
  zone: t.string(),
  acceptedAt: t.optional(t.datetime()),
  completedAt: t.optional(t.datetime()),
});

export type PetitionLinkedQuest = Static<typeof petitionLinkedQuestSchema>;

/**
 * Petition entity exposed to the API.
 *
 * Adds `attachmentUrls` so the inbox UI can render attachments without a
 * second round-trip per file, and `linkedQuests` — the quests spawned from
 * this petition (via `quests.petitionId`). Status is derived per-quest: a
 * fresh quest is `new` until accepted, `accepted` while in progress,
 * `completed` when finished.
 *
 * The reporter is identified by `reporterEmail` (inherited from the entity).
 * First-party petitions carry the logged-in user's verified account email;
 * anonymous sigil petitions carry the partner-supplied email or `null`.
 * Render `reporterEmail` as escaped plain text only — it is
 * attacker-controlled on the anonymous path. See folio #12.
 */
export const petitionResourceSchema = t.extend(petitions.schema, {
  attachmentUrls: t.optional(
    t.array(
      t.object({
        id: t.uuid(),
        name: t.string(),
        url: t.string(),
        mimeType: t.string(),
        size: t.number(),
      }),
    ),
  ),
  linkedQuests: t.optional(t.array(petitionLinkedQuestSchema)),
});

export type PetitionResource = Static<typeof petitionResourceSchema>;
