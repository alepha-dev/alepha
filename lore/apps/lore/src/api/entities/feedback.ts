import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { feedbackSourceSchema } from "../schemas/feedbackSourceSchema.ts";
import { projects } from "./projects.ts";
import { users } from "./users.ts";

/**
 * Feedback is user-submitted bug reports and feature requests. Each item
 * lands in an inbox the project owner triages: accepted (and promoted to
 * one or more quests) or rejected.
 *
 * The link lives on the quest, as `quests.feedbackId` — there is no
 * `promotedQuestId` column here, and there never was one. Keeping the pointer
 * on that side is what allows a single accepted feedback item to spawn
 * several quests, and it means deleting a quest leaves no dangling reference
 * to chase.
 *
 * Submitters must be authenticated — anonymous submissions are not allowed.
 * Feedback can carry attachments (screenshots, CSVs, logs) to give triagers
 * enough context to decide and, eventually, for AI tooling to read.
 */
export const feedback = $entity({
  name: "feedback",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    /**
     * Per-project sequential id, 1-based. Stable user-facing reference used
     * in MCP responses and UI display ("#5"). Allocated by
     * `$sequence(scope=projectId)` on insert.
     */
    shortId: z.integer().min(1),
    createdAt: db.createdAt(),
    deletedAt: db.deletedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    reporterUserId: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    title: z.string().min(1).max(200),
    description: z.string().max(10_000),
    status: z.enum(["pending", "accepted", "rejected"]).meta({ mode: "text" }),
    /**
     * Attachment file ids (uploaded via `POST /projects/:id/feedback/attachments`).
     * Stored as `uuid[]` mirroring `quests.attachments`.
     */
    attachments: db.default(z.array(z.uuid()), []),
    /**
     * Free-form tags. The `key=value` convention is documentation, not law —
     * common keys: `type=bug|feature`, `host=lore.alepha.dev`, `path=/foo`,
     * `severity=high`. Used for inbox filtering and reporting context.
     */
    tags: db.default(z.array(z.string().max(100)).max(20), []),
    /**
     * Provenance of an embedded submission. `null`/absent for first-party
     * feedback (the in-app `/p/:id/request` form). When feedback arrives
     * via a sigil-embedded widget the embedding page supplies this block so
     * the project owner sees where it came from.
     *
     * ⚠️ SECURITY: `hostUrl`, `hostPath` and `userAgent` are 100%
     * attacker-controlled (the embedding page sets them). They are shown to
     * the project owner — render them as escaped plain text only, NEVER
     * through markdown / `dangerouslySetInnerHTML`. See folio #12.
     *
     * Optional + nullable so the column is an additive `ALTER TABLE ... ADD
     * COLUMN` migration — D1-safe, no table rebuild.
     *
     * Shape lives in `feedbackSourceSchema` (shared with the request body).
     */
    source: feedbackSourceSchema.optional(),
  }),
  /**
   * ⚠️ `feedback` is a CASCADE parent since `feedback_comments` (#1281).
   * Any future migration that REBUILDS this table (the drizzle
   * `CREATE __new` / `INSERT FROM SELECT` / `DROP` pattern) wipes every
   * thread on D1, which ignores `PRAGMA foreign_keys=OFF`. Same rule as
   * `quests`: see `apps/lore/CLAUDE.md` → "Migration safety on D1".
   */
  indexes: [
    { columns: ["projectId", "status", "deletedAt"] },
    { columns: ["projectId", "createdAt"] },
    { columns: ["projectId", "shortId"], unique: true },
    { columns: ["reporterUserId", "createdAt"] },
  ],
});

export type Feedback = Infer<typeof feedback.schema>;
export type FeedbackInsert = Infer<typeof feedback.insertSchema>;
