import { type Infer, z } from "alepha";

import { artifactResourceSchema } from "./artifactResourceSchema.ts";

/**
 * What a push answers: the artifact, and whether these bytes were new.
 *
 * `stored: false` is a re-push of an identical sha256 - a retried CI step, a
 * re-run of a job - and it is a success, not a conflict. The flag exists so the
 * CLI can say "already pushed" instead of claiming an upload that never
 * happened; without it the only honest thing it could print would be a lie in
 * one of the two cases.
 */
export const artifactPushResultSchema = z.object({
  artifact: artifactResourceSchema,
  stored: z.boolean(),
  /**
   * The full quest set Lore now keeps for the pushed commit (#E154): how many
   * quests, and whether it rests on a complete history. Absent when the push
   * sent no quests or no commit.
   */
  quests: z
    .object({ count: z.integer().min(0), complete: z.boolean() })
    .optional(),
});

export type ArtifactPushResult = Infer<typeof artifactPushResultSchema>;
