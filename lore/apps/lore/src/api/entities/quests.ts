import { type Static, t } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";
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
     * Optional FK to the petition this quest was spawned from. When set, the
     * reporter of that petition can see the quest's progression on the
     * petition status page even if they are not a campaign member.
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
     * (`acceptedBy`). Interval is milliseconds between sends — the UI
     * surfaces presets (daily / weekly / custom). `undefined` means no
     * reminders are configured. Cleared on quest completion or
     * abandonment.
     */
    reminderIntervalMs: t.optional(t.integer({ minimum: 60_000 })),
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
