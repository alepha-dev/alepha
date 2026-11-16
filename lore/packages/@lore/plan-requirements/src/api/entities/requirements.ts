import { projects } from "@lore/core/schemas";
import { releases } from "@lore/plan/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { requirementPrioritySchema } from "../schemas/requirementPrioritySchema.ts";
import { requirementTypeSchema } from "../schemas/requirementTypeSchema.ts";

/**
 * A requirement (`#S<n>`, #E153): a line of the specification, with its
 * chapter and paragraph, verified by use case criteria (`criteria
 * .requirementId`) or by a metric, and shipped in a release.
 *
 * ⚠️ The source columns are plain values with no reference onto Remember's
 * tables: a requirement survives its folio, and the table migrates and
 * works in a project with Remember off. A `source` link row mirrors it.
 */
export const requirements = $entity({
  name: "requirements",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Per-project number, `#S<n>`, from `$sequence` under the property name
     * `requirementNumber` on `RequirementController`.
     */
    number: z.integer().min(1),
    statement: z.string().min(3).max(240),
    description: db.default(z.string().meta({ size: "rich" }), ""),
    type: db.default(
      requirementTypeSchema.meta({ mode: "text" }),
      "functional",
    ),
    priority: db.default(
      requirementPrioritySchema.meta({ mode: "text" }),
      "should",
    ),
    /**
     * The chapter it sits in, as the specification titles it: "3. Promotions".
     */
    chapter: z.string().max(120).optional(),
    /**
     * Its paragraph, `3.2`, shown as `§3.2`.
     */
    paragraph: z.string().max(20).optional(),
    /**
     * The folio it comes from, the heading slug of its section, and the
     * revision last synced.
     */
    sourceFolioId: z.string().max(64).optional(),
    sourceAnchor: z.string().max(200).optional(),
    sourceRevisionId: z.string().max(64).optional(),
    /**
     * The target release set BY HAND. Counts only while no covering epic
     * sits in a release: `auto` is derived on read from the covering epics
     * and never stored. `SET NULL`: deleting a release orphans it.
     */
    targetReleaseId: db.ref(z.integer().optional(), () => releases.cols.id, {
      onDelete: "set null",
    }),
  }),
  indexes: [{ columns: ["projectId", "number"], unique: true }],
});

export type Requirement = Infer<typeof requirements.schema>;
