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
 * being specified and is not released into the backlog yet" — a fact Lore
 * previously had no word for, so `quests.shelvedAt` ("deliberately out of
 * scope") was misused for it. Nothing about a quest row changes when its
 * epic is planned; the backlog gate is a read filter. See
 * `EpicVisibilityService`.
 *
 * ## Four statuses, and only the first two are set by hand (#Q2223)
 *
 * | status        | meaning                                   | reached by                           |
 * | ------------- | ----------------------------------------- | ------------------------------------ |
 * | `planned`     | being specified, quests hidden, no work   | creation; `ready` can move back      |
 * | `ready`       | specified, quests in the backlog, editable | `setEpicStatus`, by hand             |
 * | `in_progress` | the plan is frozen, quests are worked      | the first quest accepted or assigned |
 * | `completed`   | the record, terminal                       | the last open quest resolved         |
 *
 * It replaced epic #31's `planned | active | done` ratchet, whose two clicks
 * (Begin, Conclude) turned out to carry no decision: the Work-on-it prompt
 * told the agent to make both itself, and on 2026-09-10 no epic of project 1
 * was `active` at all. `ready` is the one human decision left ("the spec is
 * done"); the other two are facts, recorded by the request that makes them
 * true. `EpicWorkflowService` holds every rule and both automatic writes.
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
     *
     * ⚠️ RENAMING one is not code-only. The enum is validated on READ, so a
     * row still holding a retired value fails to decode and takes every epic
     * query with it (the 2026-08-05 shape). `active` and `done` were rewritten
     * in the same deploy that retired them, by
     * `20260910205427_epic_four_statuses`.
     */
    status: db.default(
      z
        .enum(["planned", "ready", "in_progress", "completed"])
        .meta({ mode: "text" }),
      "planned",
    ),
    /**
     * When the first quest was accepted or assigned, which is what moves an
     * epic to `in_progress`. Never cleared: nothing leaves `in_progress` but
     * completion. Was `activatedAt`, renamed with the status it stamped.
     */
    startedAt: z.datetime().optional(),
    /**
     * When the last open quest was completed or shelved. Never cleared,
     * since `completed` is terminal.
     */
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
     * `EpicWorkflowService.assertQuestWorkable`: the first quest of a `ready`
     * epic cannot be accepted or assigned while the predecessor is not
     * `completed`, so the epic cannot START. Evaluated at the start and only
     * there: the field stays writable in every phase because the roadmap
     * draws it, and a predecessor written after the start is an ordering
     * statement rather than a constraint that was ever checked. A deleted
     * predecessor is `SET NULL` and unblocks.
     *
     * It gates the start and NOT `ready`, since #Q2223: a chain of epics can
     * be specified and marked ready together, and each one opens when the one
     * before it completes. Same shape as `quests.dependsOn`, which refuses the
     * accept rather than hiding the quest. (Until #Q2223 it gated Begin, the
     * manual `planned` to `active` click.)
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
     * information. The second reason fell with it: the epic workflow refuses
     * several transitions now, so this gate is one refusal among several
     * rather than the first on the surface.
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
