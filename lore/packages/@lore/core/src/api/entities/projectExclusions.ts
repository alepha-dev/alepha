import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";

/**
 * Someone an admin removed from a project, who may not rejoin it by
 * themselves (#Q3646, epic #E151).
 *
 * A record of its own, not an audit row: the audit log is pruned by
 * retention, and an exclusion must hold until an admin lifts it. Written when
 * an admin removes a member, never when someone leaves. Lifted by an admin,
 * or by the person accepting an invitation to the project.
 */
export const projectExclusions = $entity({
  name: "project_exclusions",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    userId: z.uuid(),
    /**
     * The admin who removed them.
     */
    excludedBy: z.uuid(),
  }),
  indexes: [{ columns: ["projectId", "userId"], unique: true }],
});

export type ProjectExclusion = Infer<typeof projectExclusions.schema>;
