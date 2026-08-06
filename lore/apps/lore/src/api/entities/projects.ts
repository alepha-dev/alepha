import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

export const projectFeaturesSchema = z.object({
  kanban: z.boolean(),
  folios: z.boolean(),
  /**
   * Gates both the feedback inbox (owner triage) and the sigil feedback
   * capability (`POST /sigils/:id/feedback`). For sigil feedback, ALL
   * three gates must be on: `features.sigils` (master) AND
   * `features.feedback` AND the sigil's `kinds.includes("feedback")`.
   * Feedback arrive via TWO paths, both gated on this flag: the
   * first-party form at `/p/:projectId/request` (route
   * `projectFeedbackRequest`) and the sigil in-app dialog. Both land on
   * `POST /projects/:id/feedback`.
   */
  feedback: z.boolean(),
  milestones: z.boolean(),
  /**
   * Per-quest feature toggles. All default OFF for new projects —
   * keeps the quest view minimal until the owner opts in. Plain
   * owner-controlled switches: the Shop that used to sell `questReminder`
   * was removed along with the gold economy, so the toggle is now the
   * only gate.
   */
  questNote: z.boolean().optional(),
  questReminder: z.boolean().optional(),
  questChrono: z.boolean().optional(),
  /**
   * The Apps module master switch. Still live: it gates the sidebar section,
   * the settings page and every capability in `SigilIngestService.gatesFor`.
   *
   * Intentionally optional and absent from `defaultProjectFeatures` — adding a
   * key there changes the column DEFAULT and triggers a D1 `projects` table
   * rebuild that cascade-wipes prod. It defaults to `false` via the
   * `useProjectFeatureToggle` hook.
   */
  sigils: z.boolean().optional(),
  /**
   * @deprecated Superseded by per-app `sigils.kinds` (2026-08-06). Nothing
   * reads these three. They stay in the schema because dropping a `projects`
   * column risks the D1 rebuild path, and `projects` is the CASCADE parent
   * that wiped prod in 2026-05. Do not write them; do not re-read them.
   */
  blights: z.boolean().optional(),
  /**
   * @deprecated See {@link projectFeaturesSchema.blights}.
   */
  beacon: z.boolean().optional(),
  /**
   * @deprecated See {@link projectFeaturesSchema.blights}.
   */
  vitals: z.boolean().optional(),
});

export type ProjectFeatures = Infer<typeof projectFeaturesSchema>;

/**
 * Default feature flags. NB: the per-quest toggles (`questNote`,
 * `questReminder`, `questChrono`) are intentionally
 * absent from this object. Including them here changes the column's
 * Drizzle DEFAULT — and on D1 that triggers a table rebuild
 * (`DROP TABLE projects`) which cascade-wipes members, quests,
 * milestones, folios, feedback. See CLAUDE.md "Migration safety on D1".
 *
 * They're optional in the schema and default to `false` via the
 * `useProjectFeatureToggle` hook (`persisted[key] ?? false`).
 */
export const defaultProjectFeatures: ProjectFeatures = {
  kanban: true,
  folios: true,
  feedback: true,
  milestones: true,
};

export const projects = $entity({
  name: "projects",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
    title: z.string().min(3).max(24),
    createdBy: z.uuid(),
    /**
     * @deprecated — the public-project feature was removed. Column is kept
     * in the schema to avoid a Drizzle/D1 rebuild migration (which would
     * cascade-wipe child rows on D1 — see CLAUDE.md). No code reads or
     * writes this field. Future PR can drop it with a hand-written safe
     * `ALTER TABLE ... DROP COLUMN`.
     */
    public: z.boolean().optional(),
    icon: z.uuid().optional(),
    zones: db.default(z.array(z.string()), []),
    features: db.default(projectFeaturesSchema, defaultProjectFeatures),
    /**
     * ISO 8601 duration (e.g. "P14D", "P1M") for auto-closing milestones.
     * `null`/absent means milestones close manually only.
     */
    milestoneDuration: z.string().optional(),
    /**
     * ISO 639-1 code (e.g. "en", "fr", "ja") the project owner picks as
     * the preferred language for AI-generated content. Does NOT affect
     * the UI (that stays under each user's control) — it is surfaced via
     * `project_context` so AI agents create quests / folios in this
     * language without the user having to repeat "in French" every turn.
     * `null`/absent means no preference; agents fall back to their
     * default behavior (typically English).
     */
    preferredLanguage: z.string().optional(),
    /**
     * Blights retention window, in days. A daily purge cron deletes `open`
     * blights whose `lastSeenAt` is older than this many days (resolved and
     * `quest:`-forwarded blights are kept as audit trail). `null`/absent
     * means fall back to the global 30-day default.
     *
     * NB: declared as `z.optional` with NO `db.default(...)` ON PURPOSE.
     * Adding a Drizzle column DEFAULT triggers a `projects` table rebuild
     * on D1 (`DROP TABLE projects`) which cascade-wipes child rows — see
     * CLAUDE.md "Migration safety on D1". An optional, default-less column
     * generates a plain additive `ALTER TABLE ADD COLUMN`, which is D1-safe.
     * The 30-day fallback lives in the purge cron (`project.retentionDays
     * ?? 30`), not in the column DEFAULT.
     */
    retentionDays: z.integer().min(1).max(3_650).optional(),
    /**
     * Sub-columns rendered between "New" and "Completed" on the Kanban board.
     * Only meaningful when `features.kanban` is on. Capped at 5 columns by
     * the controller. Default is a single "In Progress" lane so existing
     * accepted quests keep a coherent column to live in.
     */
    kanbanColumns: db.default(
      z.array(z.string().min(1).max(24)).min(1).max(5),
      ["In Progress"],
    ),
    /**
     * @deprecated — the gold Shop / feature paywall was removed. Every
     * feature it used to sell (Reports, Quest Reminder, Quest Gating)
     * is now either always-on or a plain owner toggle. No code reads or
     * writes these two columns.
     *
     * They are kept in the schema ON PURPOSE: dropping a column from
     * `projects` risks the Drizzle/D1 table-rebuild path, and `projects`
     * is a CASCADE parent of members/quests/milestones/folios/feedback —
     * exactly the shape that wiped production on 2026-05-13. Same
     * treatment as the `public` column above. A future PR can drop them
     * with a hand-written, verified `ALTER TABLE ... DROP COLUMN`.
     */
    unlockedFeatures: db.default(z.array(z.string()), []),
    /** @deprecated — see `unlockedFeatures`. */
    unlockHistory: db.default(
      z.array(
        z.object({
          feature: z.string(),
          characterId: z.integer(),
          price: z.integer().min(0),
          at: z.datetime(),
        }),
      ),
      [],
    ),
  }),
  indexes: [
    {
      columns: ["createdBy"],
    },
  ],
});

export type Project = Infer<typeof projects.schema>;
