import { type Infer, z } from "alepha";

/**
 * What a review `change` item touched (#E121): a quest by its per-project
 * shortId, or an epic by its per-project number.
 *
 * A number and not a foreign key, deliberately. A foreign key from the
 * review items to `quests` would make `quests` a parent of one more table,
 * and every child is one more thing a rebuild of `quests` on D1 can wipe
 * (`apps/lore/AGENTS.md`, "Migration safety on D1"). A change item is a
 * record of what a review did, and a deleted quest it names stays a
 * number in that record.
 */
export const epicReviewTargetSchema = z.object({
  kind: z.enum(["quest", "epic"]),
  number: z.integer().min(1),
});

export type EpicReviewTarget = Infer<typeof epicReviewTargetSchema>;
