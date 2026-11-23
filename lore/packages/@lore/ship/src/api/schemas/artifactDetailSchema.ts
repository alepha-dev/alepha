import { hosts } from "@lore/core/schemas";
import { type Infer, z } from "alepha";

import { deployments } from "../entities/deployments.ts";
import { artifactGroupSchema } from "./artifactGroupSchema.ts";

/**
 * One tag on its own page: its variants with their manifests, every copy of
 * the app, and the runs that shipped this tag.
 *
 * `copies` is every copy of the APP and not only those running this tag: the
 * page compares digests, and "not running this" is an answer it has to give.
 */
export const artifactDetailSchema = artifactGroupSchema.extend({
  copies: z.array(
    z.object({
      id: z.uuid(),
      env: z.string(),
      host: hosts.schema
        .pick({ slug: true, type: true, label: true })
        .optional(),
      /**
       * The newest succeeded run's snapshot. Absent for a copy that has never
       * deployed.
       */
      deployed: z
        .object({
          tag: z.string(),
          sha256: z.string(),
          at: z.string(),
        })
        .optional(),
    }),
  ),
  /**
   * The runs that shipped this tag, newest first, capped at
   * `ArtifactDetailService.MAX_RUNS`. ⚠️ Picked rather than the whole row:
   * `log` is the one column here that can be large.
   */
  deployments: z.array(
    deployments.schema
      .pick({
        id: true,
        instanceId: true,
        sha256: true,
        status: true,
        url: true,
        error: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
      })
      .extend({
        env: z.string().optional(),
        /**
         * Who started the run, by the name a project member reads
         * (`displayName`). Absent for a run nobody started by hand (CI
         * with a project key) and for an author no longer in the project.
         */
        author: z.text().optional(),
      }),
  ),
});

export type ArtifactDetail = Infer<typeof artifactDetailSchema>;
