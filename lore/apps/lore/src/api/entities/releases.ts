import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";

/**
 * A named goal that holds the epics and quests due to ship in it.
 *
 * ⚠️ `releases` is a RECYCLED table name. A table called `releases` existed
 * until 2026-08-05 and meant a *deploy*: created in
 * `20260803133023_tearful_drax`, renamed to `deployments` in
 * `20260805145510_lively_payback`. Migration history therefore contains two
 * unrelated `releases`; the one this entity maps to is the former
 * `milestones` table, renamed in the Lore Release epic.
 */
export const releases = $entity({
  name: "releases",
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
     * `releaseDuration` setting. `null` means manual close only.
     */
    closesAt: z.datetime().optional(),
    closedAt: z.datetime().optional(),
    /**
     * Free-form labels: "v1.0.0", "finale", "hotfix"…
     */
    tags: db.default(z.array(z.string()), []),
    /**
     * Snapshot markdown rendered at close time. Authoritative changelog
     * for closed releases. While the release is active, the changelog is
     * computed live from completed quests within the release's window.
     */
    changelog: z.string().meta({ size: "rich" }).optional(),
  }),
  indexes: [
    { columns: ["projectId"] },
    { columns: ["projectId", "number"], unique: true },
  ],
});

export type Release = Infer<typeof releases.schema>;
