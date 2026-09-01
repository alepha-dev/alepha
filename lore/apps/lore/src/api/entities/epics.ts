import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";
import { releases } from "./releases.ts";

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
    /**
     * The release this epic is due to ship in. At most one.
     *
     * A single FK rather than a join table, decided 2026-08-29: an epic that
     * would span `0.1.0` and `0.2.0` gets **split into two epics**, which is
     * the honest answer rather than a limitation. "Partly in demo-1" is not a
     * shippable statement, and a shared epic makes "the progress of 0.1.0"
     * ambiguous in a way no rule fixes cleanly.
     *
     * `SET NULL` and not `CASCADE`: deleting a release orphans its epics, it
     * never deletes them. Deleting a release has to stay cheap - a release
     * that locks itself is exactly what made the recorder unusable.
     *
     * ⚠️ Declared optional with NO `db.default(...)` so the migration is a
     * plain additive `ALTER TABLE ADD COLUMN`. A column DEFAULT triggers a
     * table rebuild on D1. Precedent: `quests.epicId`.
     */
    releaseId: db.ref(z.integer().optional(), () => releases.cols.id, {
      onDelete: "set null",
    }),
    /**
     * The epic that has to come first. At most one.
     *
     * It exists so the ordering between epics can be **drawn** rather than
     * described. Before it, that order lived in prose - this epic's own
     * description opened with "Depends on epic #14 landing first", and folio
     * #1154's six-epic chain was a mermaid diagram pasted into a description.
     * Neither can be rendered, sorted or checked.
     *
     * ## ⚠️ ADVISORY, not a gate. Decided deliberately, 2026-09-01.
     *
     * `quests.dependsOn` is a real gate: while the predecessor is incomplete,
     * `acceptQuest` refuses to assign the quest. Consistency argued for the
     * same here - `setEpicStatus` refusing `active` while the predecessor is
     * not `done` - and it was rejected, for three reasons:
     *
     * 1. **The units are not comparable.** A quest gate refuses ONE person
     *    starting ONE task, and is worked around by finishing the predecessor.
     *    Epics overlap by design: starting B while A is finishing is normal
     *    planning, not a mistake, and a refusal there would make people stop
     *    setting the field rather than start respecting it.
     * 2. **`setEpicStatus` has no forbidden edge today**, on purpose - all
     *    nine transitions are legal and its own doc says so. This would be the
     *    first refusal on that surface, with no force flag to get past it.
     * 3. **The direction is reversible one way only.** Adding the gate later
     *    is additive; removing one people have built round is a behaviour
     *    change to undo. Advisory first is the cheaper mistake.
     *
     * So the roadmap draws "after Epic N" and nothing is refused. If the gate
     * is ever wanted, it goes on `setEpicStatus`, and this comment is the
     * record of what was weighed.
     *
     * **Cycles ARE rejected on write**, which is not the same decision.
     * `A → B → A` is not a workflow preference, it is a graph the renderer
     * cannot terminate on, and nothing else in a self-reference prevents it.
     * `EpicDependencyService` walks the chain on every write.
     *
     * ⚠️ `SET NULL` and not `CASCADE`: deleting a predecessor unblocks its
     * dependents, it never deletes them. Doubly so once `epic_delete` exists.
     *
     * ⚠️ Declared optional with NO `db.default(...)`, so the migration is a
     * plain additive `ALTER TABLE ADD COLUMN`. A column DEFAULT triggers a
     * table rebuild, and a `DROP TABLE epics` in a generated migration would
     * fire SET NULL against the copied rows in both `quests` and `folios`,
     * detaching every quest and folio from its epic silently. Precedent, and
     * the same warning: `quests.epicId`.
     */
    dependsOn: db.ref(z.integer().optional(), () => epics.cols.id, {
      onDelete: "set null",
    }),
  }),
  indexes: [
    { columns: ["projectId", "number"], unique: true },
    { columns: ["projectId", "status"] },
    { columns: ["releaseId"] },
  ],
});

export type Epic = Infer<typeof epics.schema>;
