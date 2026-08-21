import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";

/**
 * A part of the system a quest belongs to — a module, a package, a
 * surface. Every quest carries exactly one.
 *
 * Orthogonal to `epics` (a bounded initiative that spans areas and ends)
 * and to `quests.tags` (the nature of the work: bug, feat, chore). Area
 * had been absorbing all three axes, which is what made the list
 * unusable — see the spec.
 *
 * `quests.area` deliberately stays a plain STRING joined by name rather
 * than a foreign key: this table is metadata, and keeping it out of
 * `quests` means the largest table is never migrated. Rename is a single
 * `updateMany`, which is free at this scale.
 *
 * Invariant, held by `AreaService.ensureArea` + the backfill migration:
 * every distinct non-empty `quests.area` value in a project has exactly
 * one row here.
 */
export const areas = $entity({
  name: "areas",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    name: z.string().min(1).max(48),
    description: db.default(z.string().meta({ size: "rich" }), ""),
    /**
     * A palette token, never a hex value — the UI maps it to a theme
     * variable so an area stays legible in light and dark.
     *
     * `mode: "text"` ⇒ no DB-level CHECK constraint, so extending the
     * palette later is a code-only change with no migration. Same
     * reasoning as `epics.status` and `folioLinks.targetType`.
     */
    color: z
      .enum([
        "slate",
        "blue",
        "green",
        "amber",
        "red",
        "violet",
        "cyan",
        "pink",
      ])
      .meta({ mode: "text" })
      .optional(),
  }),
  indexes: [{ columns: ["projectId", "name"], unique: true }],
});

export type Area = Infer<typeof areas.schema>;
