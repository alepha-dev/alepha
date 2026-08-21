import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";

export const milestones = $entity({
  name: "milestones",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    number: z.integer().min(1),
    title: z.string().min(1).max(100),
    description: db.default(z.string().meta({ size: "rich" }), ""),
    /**
     * Auto-close deadline computed at start time from the project's
     * `milestoneDuration` setting. `null` means manual close only.
     */
    closesAt: z.datetime().optional(),
    closedAt: z.datetime().optional(),
    /**
     * Free-form labels: "v1.0.0", "finale", "hotfix"…
     */
    tags: db.default(z.array(z.string()), []),
    /**
     * Snapshot markdown rendered at close time. Authoritative changelog
     * for closed milestones. While the milestone is active, the changelog is
     * computed live from completed quests within the milestone's window.
     */
    changelog: z.string().meta({ size: "rich" }).optional(),
  }),
  indexes: [
    { columns: ["projectId"] },
    { columns: ["projectId", "number"], unique: true },
  ],
});

export type Milestone = Infer<typeof milestones.schema>;
