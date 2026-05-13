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
 * Adds `reporter` (resolved from `reporterUserId`), `attachmentUrls` so the
 * inbox UI can render attachments without a second round-trip per file, and
 * `linkedQuests` — the quests spawned from this petition (via
 * `quests.petitionId`). Status is derived per-quest: a fresh quest is `new`
 * until accepted, `accepted` while in progress, `completed` when finished.
 */
export const petitionResourceSchema = t.extend(petitions.schema, {
  reporter: t.optional(
    t.object({
      id: t.uuid(),
      username: t.optional(t.string()),
      name: t.optional(t.string()),
      picture: t.optional(t.string()),
    }),
  ),
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
