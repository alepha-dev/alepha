import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";

/**
 * A bounded initiative inside a project: it spans several areas, owns
 * quests and folios, and ends.
 *
 * Orthogonal to `quests.area`, which labels the module the work happens
 * in. A quest carries both, independently.
 *
 * `planned` is the reason this entity exists. It means "this work is
 * specified and is not released into the backlog yet" — a fact Lore
 * previously had no word for, so `quests.shelvedAt` ("deliberately out of
 * scope") was misused for it. Nothing about a quest row changes when its
 * epic is planned; the backlog gate is a read filter. See
 * `EpicVisibilityService`.
 */
export const epics = $entity({
  name: "epics",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Per-project sequential id, 1-based. Allocated by
     * `$sequence(scope=projectId)` under the key `epicNumber`.
     *
     * `$sequence` keys its counter on the PROPERTY NAME, so renaming the
     * `epicNumber` property on EpicController restarts every project's
     * counter at 1 and collides with its own history. A rename needs an
     * `UPDATE alepha_sequences SET name = ...` migration, exactly as the
     * `chapterNumber` → `releaseNumber` rename did.
     */
    number: z.integer().min(1),
    title: z.string().min(3).max(80),
    description: db.default(z.string().meta({ size: "rich" }), ""),
    /**
     * `mode: "text"` ⇒ no DB-level CHECK constraint, so adding a status
     * later is a code-only change with no migration. Same reasoning as
     * `folioLinks.targetType`.
     */
    status: db.default(
      z.enum(["planned", "active", "done"]).meta({ mode: "text" }),
      "planned",
    ),
    activatedAt: z.datetime().optional(),
    completedAt: z.datetime().optional(),
  }),
  indexes: [
    { columns: ["projectId", "number"], unique: true },
    { columns: ["projectId", "status"] },
  ],
});

export type Epic = Infer<typeof epics.schema>;
