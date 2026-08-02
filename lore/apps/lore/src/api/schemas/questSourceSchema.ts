import { type Infer, z } from "alepha";

/**
 * Provenance of a quest that was spawned from an automated source rather
 * than authored directly. Absent for hand-authored quests.
 *
 * Currently the only producer is the Blights inbox "forward to quest"
 * action — it stamps `sigilBlightId` so the quest links back to the
 * blight row it triaged.
 *
 * Stored as an opaque JSON object on `quests.source` — additive, D1-safe
 * (a nullable column add, never a table rebuild). New fields can be added
 * to this schema without a migration.
 */
export const questSourceSchema = z.object({
  /**
   * The `sigil_blights` row this quest was forwarded from. Set by the
   * Blights inbox forward-to-quest action; the matching blight carries
   * `status = "quest:<questId>"` so the link is bidirectional.
   */
  sigilBlightId: z.integer().optional(),
});

export type QuestSource = Infer<typeof questSourceSchema>;
