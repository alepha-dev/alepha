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
     * ## ⚠️ A GATE since 2026-09-04 (epic #31). It was advisory for three days.
     *
     * `EpicWorkflowService.assertCanBegin`: `setEpicStatus` refuses the move
     * to `active` while the predecessor is not `done`. Evaluated at Begin and
     * only there: the field stays writable in every phase because the roadmap
     * draws it, and a predecessor written after Begin is an ordering statement
     * rather than a constraint that was ever checked. A deleted predecessor is
     * `SET NULL` and unblocks.
     *
     * **The record of the decision it reversed.** On 2026-09-01 this column
     * shipped advisory, deliberately, for three reasons: the units are not
     * comparable (a quest gate refuses one person starting one task, epics
     * overlap by design), `setEpicStatus` had no forbidden edge at all and this
     * would have been the first, and adding a gate later is additive while
     * removing one is a behaviour change, so advisory was the cheaper mistake.
     * That comment ended with "if the gate is ever wanted, it goes on
     * `setEpicStatus`, and this comment is the record of what was weighed".
     *
     * **What changed the answer is evidence, not taste.** The advisory channel
     * already existed elsewhere and measured zero: `quest_list` and `quest_get`
     * stamp the epic's status on every quest, with a description spelling out
     * that a planned epic's quests are not released, and epic #27 was worked
     * to 9 of 9 quests completed while still `planned`, by an agent told that
     * status on every single call. A note is decoration; a refusal is
     * information. The second reason fell with it: `setEpicStatus` is a
     * one-way ratchet now and refuses seven of its nine former edges, so this
     * gate is one refusal among several rather than the first on the surface.
     * The overlap concern is answered by the successor route: an epic that
     * genuinely starts before its predecessor ends records no predecessor.
     *
     * **Cycles ARE rejected on write**, which was never the same decision.
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
    /**
     * The activity feed's window scan (`ProjectActivityService.epicEvents`).
     * Same shape and same reason as the one on `quests`.
     */
    { columns: ["projectId", "updatedAt"] },
  ],
});

export type Epic = Infer<typeof epics.schema>;
