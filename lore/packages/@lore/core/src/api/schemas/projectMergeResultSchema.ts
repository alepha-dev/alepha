import { type Infer, z } from "alepha";

/**
 * What `mergeProject` and the `project_merge` MCP tool answer (#E94,
 * #Q2783): the plan of every step, applied or not, and the mapping folio's
 * markdown built from it. `ProjectMergePlan` is its TypeScript side; a
 * field missing here is dropped from the response silently, so the two are
 * kept field for field.
 */
export const projectMergeResultSchema = z.object({
  sourceProjectId: z.integer(),
  targetProjectId: z.integer(),
  dryRun: z.boolean(),
  steps: z.array(
    z.object({
      name: z.string(),
      moved: z.record(z.string(), z.integer()),
      renumbered: z.array(
        z.object({
          kind: z.string(),
          id: z.union([z.string(), z.integer()]),
          from: z.integer(),
          to: z.integer(),
        }),
      ),
      joined: z.array(
        z.object({
          kind: z.string(),
          key: z.string(),
          sourceId: z.union([z.string(), z.integer()]),
          targetId: z.union([z.string(), z.integer()]),
        }),
      ),
      changed: z.array(
        z.object({
          kind: z.string(),
          id: z.union([z.string(), z.integer()]),
          field: z.string(),
          from: z.string(),
          to: z.string(),
        }),
      ),
      conflicts: z
        .array(
          z.object({
            kind: z.string(),
            key: z.string(),
            sourceId: z.union([z.string(), z.integer()]),
            targetId: z.union([z.string(), z.integer()]),
          }),
        )
        .optional(),
      rewritten: z.record(z.string(), z.integer()).optional(),
    }),
  ),
  /**
   * The mapping folio's markdown, ready to publish in the target.
   */
  report: z.string(),
});

export type ProjectMergeResult = Infer<typeof projectMergeResultSchema>;
