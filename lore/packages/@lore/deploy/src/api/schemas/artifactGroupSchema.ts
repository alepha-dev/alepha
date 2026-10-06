import { type Infer, z } from "alepha";

import { artifactResourceSchema } from "./artifactResourceSchema.ts";

/**
 * One `(app, tag)` and every runtime built for it.
 *
 * ## ⚠️ This shape is the model, not a display convenience
 *
 * `artifacts` is unique on `(projectId, app, tag, runtime)` precisely so that
 * `1.2.3` names ONE release that may carry a workerd build and a node build.
 * A flat list of rows contradicts that on the first screen anyone sees: two
 * variants of one release read as two releases, and the reader has to
 * reassemble the model from the runtime column.
 *
 * So the grouping happens here, once, rather than in each of the three
 * surfaces that render it - the app page, the release page and the MCP tool.
 */
export const artifactGroupSchema = z.object({
  app: z.string(),
  /**
   * Case-preserved, because it is the join key to `releases.tag`.
   */
  tag: z.string(),
  /**
   * When the newest variant's bytes landed.
   *
   * ⚠️ Derived from `updatedAt`, never `createdAt`. `latest` is replaced in
   * place, so its `createdAt` is the day the tag first existed - which for a
   * tag that moves daily is a date nobody wants. "Pushed at" means when these
   * bytes arrived.
   */
  pushedAt: z.string(),
  /**
   * The commit the newest variant was built from, when CI said. Absent
   * otherwise: a push from a laptop has no commit to name.
   */
  commitSha: z.string().optional(),
  /**
   * Every runtime under this tag, ordered by runtime name so the list does not
   * reshuffle between two reads that pushed nothing.
   */
  variants: z.array(artifactResourceSchema),
});

export type ArtifactGroup = Infer<typeof artifactGroupSchema>;
