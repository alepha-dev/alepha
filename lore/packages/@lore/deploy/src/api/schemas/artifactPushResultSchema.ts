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
});

export type ArtifactPushResult = Infer<typeof artifactPushResultSchema>;
