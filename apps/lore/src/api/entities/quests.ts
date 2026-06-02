import { type Static, t } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";
import { questSourceSchema } from "../schemas/questSourceSchema.ts";
import { campaigns } from "./campaigns.ts";
import { chapters } from "./chapters.ts";
import { petitions } from "./petitions.ts";

export const quests = $entity({
  name: "quests",
  schema: t.object({
    id: db.primaryKey(t.integer()),
    /**
     * Per-campaign sequential id, 1-based. Stable user-facing reference used
     * in URLs (`/c/:campaignId/q/:shortId`) and UI display ("#42"). Allocated
     * by `$sequence(scope=campaignId)` on insert. The global `id` remains the
     * canonical PK for foreign keys and stable MCP/agent references.
     */
    shortId: t.integer({ minimum: 1 }),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
    title: t.string(),
    description: t.string({ size: "rich" }),
    zone: t.string(),
    priority: t.enum(["optional", "low", "medium", "high"], { mode: "text" }),
    difficulty: t.integer({ minimum: 1, maximum: 5 }),
    acceptedAt: t.optional(t.datetime()),
    completedAt: t.optional(t.datetime()),
    /**
     * Free-form summary set when the quest closes — what was actually
     * done. Editable post-completion via `updateQuest` (campaign memory
     * is meant to be curated). Surfaced to humans in the quest view +
     * history timeline preview, and returned by MCP `quest_get` /
     * `campaign_context` so future agents can read prior summaries.
     */
    completionMessage: t.optional(t.string({ size: "rich" })),
    /**
     * Set whenever `completionMessage` is written or edited. Lets the UI
     * show an "edited <time> ago" hint so amendments are visible rather
     * than silently rewriting history.
     */
    completionMessageUpdatedAt: t.optional(t.datetime()),
    /**
     * Kanban sub-column the quest sits in while `status === "accepted"`.
     * Only used when the campaign's `kanban` feature is on. Free-form text
     * that must match one of the campaign's configured `kanbanColumns`.
     * Cleared when the quest moves back to "New" or forward to "Completed".
     */
    kanbanColumn: t.optional(t.string()),
    objectives: db.default(
      t.array(
        t.object({
          /**
           * Per-quest integer identifier, stable across reorders / edits.
           * Optional because legacy rows pre-date this field — the controller
           * lazily backfills (id = index) on first write that touches the
           * objectives array. New objectives get `max(existing) + 1`.
           */
          id: t.optional(t.integer({ minimum: 0 })),
          title: t.string(),
          completed: t.boolean(),
        }),
      ),
      [],
    ),
    campaignId: db.ref(t.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    chapterId: db.ref(t.optional(t.integer()), () => chapters.cols.id, {
      onDelete: "set null",
    }),
    /**
     * Optional FK to the petition this quest was spawned from. When set, any
     * user whose email matches `petition.reporterEmail` can see this quest's
     * progression on the petition status page even without campaign membership.
     * If the petition's `reporterEmail` is null (anonymous sigil submission),
     * only the campaign owner can view the status page.
     */
    petitionId: db.ref(t.optional(t.integer()), () => petitions.cols.id, {
      onDelete: "set null",
    }),
    createdBy: db.ref(t.uuid(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    acceptedBy: db.ref(t.optional(t.uuid()), () => users.cols.id, {
      onDelete: "set null",
    }),
    completedBy: db.ref(t.optional(t.uuid()), () => users.cols.id, {
      onDelete: "set null",
    }),
    history: t.array(
      t.object({
        at: t.datetime(),
        by: t.uuid(),
        action: t.enum([
          "updated",
          "assigned",
          "unassigned",
          "objective_completed",
          "reminder_sent",
        ]),
        /**
         * For `objective_completed` entries — the id of the toggled
         * objective. Optional for legacy history rows that pre-date
         * this field. When set, unchecking the matching objective
         * removes this exact row instead of appending a noisy "still
         * unchecked" event (see quest #23 — "History Spam").
         */
        objectiveId: t.optional(t.integer({ minimum: 0 })),
      }),
      { default: [] },
    ),
    note: db.default(t.string({ size: "rich" }), ""),
    /**
     * Opt-in periodic reminder for the quest's assignee
     * (`acceptedBy`). One of the three cadence presets the UI offers.
     * `undefined` means no reminders are configured. Cleared on quest
     * completion or abandonment. The sweep maps the enum to a duration
     * via `REMINDER_INTERVAL_MS` to advance `reminderNextAt`.
     */
    reminderInterval: t.optional(
      t.enum(["daily", "weekly", "monthly"], { mode: "text" }),
    ),
    /**
     * Timestamp at which the next reminder email should fire. Maintained
     * by `setQuestReminder` (set to now + interval on enable) and the
     * `QuestJobs` reminder sweep (advanced by interval after each send).
     * `undefined` when no reminder is configured or when the quest is
     * completed/abandoned.
     */
    reminderNextAt: t.optional(t.datetime()),
    timerSessions: db.default(
      t.array(
        t.object({
          startedAt: t.datetime(),
          stoppedAt: t.optional(t.datetime()),
        }),
      ),
      [],
    ),
    attachments: db.default(t.array(t.uuid()), []),
    /**
     * Free-form labels for the **nature** of the quest (`bug`, `feat`,
     * `chore`, `regression`, …) — orthogonal to `zone`, which labels the
     * **module/scope**. Stored as a JSON array of normalized strings
     * (trimmed, lowercased, deduped). Filter via `like '%"value"%'` on
     * the serialized blob — mirrors the folio tag pattern.
     */
    tags: db.default(t.array(t.string()), []),
    /**
     * Optional predecessor quest in the same campaign. While the
     * predecessor's `completedAt` is null, `acceptQuest` refuses to
     * assign this quest — the UI surfaces a "Blocked by #N" badge that
     * flips to "Unblocked" once the predecessor closes. ON DELETE
     * SET NULL so deleting the predecessor doesn't cascade-wipe its
     * dependents (those keep going as standalone quests).
     */
    dependsOn: db.ref(t.optional(t.integer()), () => quests.cols.id, {
      onDelete: "set null",
    }),
    /**
     * Soft level gating — when set, characters below this level see a
     * warning on the accept button but can still pick up the quest. UI
     * only surfaces this field when the campaign has sponsored the
     * Quest Gating feature; the schema is always present so the column
     * doesn't need a later migration.
     */
    recommendedLevel: t.optional(t.integer({ minimum: 1 })),
    /**
     * Hard level gating — when set, characters below this level cannot
     * accept the quest (server-enforced). Same UI gating as
     * `recommendedLevel`.
     */
    requiredLevel: t.optional(t.integer({ minimum: 1 })),
    /**
     * Provenance for quests spawned by an automated source (currently the
     * Blights inbox forward-to-quest action). Absent for hand-authored
     * quests. Opaque JSON — adding fields to `questSourceSchema` never
     * needs a migration. See `questSourceSchema`.
     */
    source: t.optional(questSourceSchema),
  }),
  indexes: [
    {
      columns: ["campaignId", "deletedAt"],
    },
    {
      columns: ["campaignId", "shortId"],
      unique: true,
    },
    {
      columns: ["acceptedBy"],
    },
    {
      columns: ["completedBy"],
    },
    {
      columns: ["chapterId"],
    },
  ],
});

export type Quest = Static<typeof quests.schema>;
export type QuestUpdate = Static<typeof quests.updateSchema>;
export type QuestInsert = Static<typeof quests.insertSchema>;

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

export const REMINDER_INTERVAL_VALUES: readonly ReminderInterval[] = [
  "daily",
  "weekly",
  "monthly",
];

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
