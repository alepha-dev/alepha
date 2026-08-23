import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

import { questCommitSchema } from "../schemas/questCommitSchema.ts";
import { questSourceSchema } from "../schemas/questSourceSchema.ts";
import { epics } from "./epics.ts";
import { feedback } from "./feedback.ts";
import { milestones } from "./milestones.ts";
import { projects } from "./projects.ts";

export const quests = $entity({
  name: "quests",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    /**
     * Per-project sequential id, 1-based. Stable user-facing reference used
     * in URLs (`/:projectSlug/q/:shortId`) and UI display ("#42"). Allocated
     * by `$sequence(scope=projectId)` on insert. The global `id` remains the
     * canonical PK for foreign keys and stable MCP/agent references.
     */
    shortId: z.integer().min(1),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
    title: z.string(),
    description: z.string().meta({ size: "rich" }),
    area: z.string(),
    priority: z
      .enum(["optional", "low", "medium", "high"])
      .meta({ mode: "text" }),
    /**
     * Optional, glanceable time estimate in minutes — "how long might this
     * take". A motivation aid surfaced in the questlog as a small `~15m`
     * pill, so a viewer can pick a quest that fits the time they have.
     * Deliberately NOT estimate-vs-actual — that role belongs to
     * `timerSessions`. `undefined`
     * means no estimate. Stored as raw minutes; the UI offers coarse presets
     * (5m…1d, where 1d = one 480-minute workday) plus a custom input.
     */
    estimateMinutes: z.integer().min(1).optional(),
    acceptedAt: z.datetime().optional(),
    completedAt: z.datetime().optional(),
    /**
     * Optional deadline, shown as a chip on the quest and a row in its rail.
     *
     * Distinct from `reminderInterval` / `reminderNextAt`, which are a
     * recurring nudge to the assignee and say nothing about when the work is
     * wanted. Nullable and never backfilled: a quest without a deadline is
     * the normal case, not a missing value.
     */
    dueAt: z.datetime().optional(),
    /**
     * Set when the quest is shelved — deliberately set aside as out of
     * scope for now, without deleting it. Only quests still in `new`
     * status can be shelved, so this is never set alongside `acceptedAt`
     * or `completedAt`. Shelved quests are hidden from the default quest
     * list and excluded from progress/stats denominators; they come back
     * via `unshelveQuest` (or implicitly, by accepting them).
     */
    shelvedAt: z.datetime().optional(),
    shelvedBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    /**
     * Free-form summary set when the quest closes — what was actually
     * done. Editable post-completion via `updateQuest` (project memory
     * is meant to be curated). Surfaced to humans in the quest view +
     * history timeline preview, and returned by MCP `quest_get` /
     * `project_context` so future agents can read prior summaries.
     */
    completionMessage: z.string().meta({ size: "rich" }).optional(),
    /**
     * Set whenever `completionMessage` is written or edited. Lets the UI
     * show an "edited <time> ago" hint so amendments are visible rather
     * than silently rewriting history.
     */
    completionMessageUpdatedAt: z.datetime().optional(),
    /**
     * Kanban sub-column the quest sits in while `status === "accepted"`.
     * Only used when the project's `kanban` feature is on. Free-form text
     * that must match one of the project's configured `kanbanColumns`.
     * Cleared when the quest moves back to "New" or forward to "Completed".
     */
    kanbanColumn: z.string().optional(),
    objectives: db.default(
      z.array(
        z.object({
          /**
           * Per-quest integer identifier, stable across reorders / edits.
           * Optional because legacy rows pre-date this field — the controller
           * lazily backfills (id = index) on first write that touches the
           * objectives array. New objectives get `max(existing) + 1`.
           */
          id: z.integer().min(0).optional(),
          title: z.string(),
          completed: z.boolean(),
          /**
           * Why this objective was skipped rather than done, set when the
           * quest was completed with it still unticked.
           *
           * A waived objective is NOT marked completed: it stays unticked
           * and carries the reason instead. That is the whole point. A box
           * ticked by someone who did not do the work looks exactly like a
           * real one, which is worse than an honest gap, and the gate used
           * to leave no third option.
           *
           * Written only by `completeQuest`, never by an objectives edit:
           * waiving is part of closing a quest, not a property of the
           * objective that anyone can set in passing.
           */
          waivedReason: z.string().optional(),
          waivedBy: z.uuid().optional(),
          waivedAt: z.datetime().optional(),
        }),
      ),
      [],
    ),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    milestoneId: db.ref(z.integer().optional(), () => milestones.cols.id, {
      onDelete: "set null",
    }),
    /**
     * Optional FK to the feedback this quest was spawned from. When set, the
     * reporter of that feedback can see the quest's progression on the
     * feedback status page even if they are not a project member.
     */
    feedbackId: db.ref(z.integer().optional(), () => feedback.cols.id, {
      onDelete: "set null",
    }),
    createdBy: db.ref(z.uuid(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    acceptedBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    completedBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    history: z
      .array(
        z.object({
          at: z.datetime(),
          by: z.uuid(),
          action: z.enum([
            "updated",
            "assigned",
            "unassigned",
            "objective_completed",
            "objective_waived",
            "reminder_sent",
            "shelved",
            "unshelved",
          ]),
          /**
           * For `objective_completed` entries — the id of the toggled
           * objective. Optional for legacy history rows that pre-date
           * this field. When set, unchecking the matching objective
           * removes this exact row instead of appending a noisy "still
           * unchecked" event (see quest #23 — "History Spam").
           */
          objectiveId: z.integer().min(0).optional(),
        }),
      )
      .default([]),
    /**
     * @deprecated The quest note feature was deleted (2026-08-20). Nothing
     * reads or writes this column anymore.
     *
     * It stays declared on purpose: dropping it is a `quests` table
     * rebuild, and on D1 the `DROP TABLE quests` step fires
     * `dependsOn`'s `ON DELETE SET NULL` against the freshly copied rows,
     * erasing every questline link. Removing it from this schema instead
     * of deleting the column would make `check:migrations` propose exactly
     * that rebuild. Precedent: `projects.public`, `folios.tags`.
     */
    note: db.default(z.string().meta({ size: "rich" }), ""),
    /**
     * Opt-in periodic reminder for the quest's assignee
     * (`acceptedBy`). One of the three cadence presets the UI offers.
     * `undefined` means no reminders are configured. Cleared on quest
     * completion or abandonment. The sweep maps the enum to a duration
     * via `REMINDER_INTERVAL_MS` to advance `reminderNextAt`.
     */
    reminderInterval: z
      .enum(["daily", "weekly", "monthly"])
      .meta({ mode: "text" })
      .optional(),
    /**
     * Timestamp at which the next reminder email should fire. Maintained
     * by `setQuestReminder` (set to now + interval on enable) and the
     * `QuestJobs` reminder sweep (advanced by interval after each send).
     * `undefined` when no reminder is configured or when the quest is
     * completed/abandoned.
     */
    reminderNextAt: z.datetime().optional(),
    timerSessions: db.default(
      z.array(
        z.object({
          startedAt: z.datetime(),
          stoppedAt: z.datetime().optional(),
        }),
      ),
      [],
    ),
    attachments: db.default(z.array(z.uuid()), []),
    /**
     * Free-form labels for the **nature** of the quest (`bug`, `feat`,
     * `chore`, `regression`, …) — orthogonal to `area`, which labels the
     * **module/scope**. Stored as a JSON array of normalized strings
     * (trimmed, lowercased, deduped). Filter via `like '%"value"%'` on
     * the serialized blob — mirrors the folio tag pattern.
     */
    tags: db.default(z.array(z.string()), []),
    /**
     * Optional predecessor quest in the same project. While the
     * predecessor's `completedAt` is null, `acceptQuest` refuses to
     * assign this quest — the UI surfaces a "Blocked by #N" badge that
     * flips to "Unblocked" once the predecessor closes. ON DELETE
     * SET NULL so deleting the predecessor doesn't cascade-wipe its
     * dependents (those keep going as standalone quests).
     */
    dependsOn: db.ref(z.integer().optional(), () => quests.cols.id, {
      onDelete: "set null",
    }),
    /**
     * Optional owning epic. `SET NULL` on delete: removing an epic orphans
     * its quests, it never deletes them.
     *
     * ⚠️ Declared optional with NO `db.default(...)` so the migration is a
     * plain additive `ALTER TABLE ADD COLUMN`. A column DEFAULT triggers a
     * table rebuild on D1.
     */
    epicId: db.ref(z.integer().optional(), () => epics.cols.id, {
      onDelete: "set null",
    }),
    /**
     * Provenance for quests spawned by an automated source (currently the
     * Blights inbox forward-to-quest action). Absent for hand-authored
     * quests. Opaque JSON — adding fields to `questSourceSchema` never
     * needs a migration. See `questSourceSchema`.
     */
    source: questSourceSchema.optional(),
    /**
     * What shipped for this quest, appended as commits land.
     *
     * ⚠️ Optional with NO `db.default(...)` so the migration is a plain
     * additive `ALTER TABLE ADD COLUMN`. A column DEFAULT triggers a table
     * rebuild, and on D1 `DROP TABLE quests` fires `dependsOn`'s SET NULL
     * against the copied rows AND cascades `quest_comments`, wiping every
     * questline link and every discussion. See `apps/lore/CLAUDE.md` →
     * "Migration safety on D1". Same reasoning as `epicId`.
     *
     * A JSON array rather than a `quest_commits` table because a handful of
     * commits per quest is the expected shape, and a table would be a
     * second cascade child on `quests` to worry about forever.
     */
    commits: z.array(questCommitSchema).optional(),
  }),
  indexes: [
    {
      columns: ["projectId", "deletedAt"],
    },
    {
      columns: ["projectId", "shortId"],
      unique: true,
    },
    {
      columns: ["acceptedBy"],
    },
    {
      columns: ["completedBy"],
    },
    {
      columns: ["milestoneId"],
    },
  ],
});

export type Quest = Infer<typeof quests.schema>;
export type QuestUpdate = Infer<typeof quests.updateSchema>;
export type QuestInsert = Infer<typeof quests.insertSchema>;

export type ReminderInterval = NonNullable<Quest["reminderInterval"]>;

/**
 * Cadence presets exposed by the API/UI. Single source of truth — both
 * the controller (computing `reminderNextAt`) and the nightly sweep
 * (advancing `reminderNextAt`) read from this map.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
export const REMINDER_INTERVAL_MS: Record<ReminderInterval, number> = {
  daily: DAY_MS,
  weekly: 7 * DAY_MS,
  monthly: 30 * DAY_MS,
};

export const REMINDER_INTERVAL_VALUES = ["daily", "weekly", "monthly"] as const;

/**
 * Normalize a tag list: trim, lowercase, dedupe (preserve first occurrence
 * order), drop empties. Single source of truth so the API, MCP, and any
 * future seed paths agree on what gets persisted.
 */
export const normalizeQuestTags = (raw: readonly string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw_ of raw) {
    const v = raw_.trim().toLowerCase();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
};
