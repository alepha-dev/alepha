import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { kanbanColumnConfigSchema } from "../schemas/kanbanColumnSchema.ts";
import { paletteColorSchema } from "../schemas/paletteColorSchema.ts";

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
  /**
   * Gates the Releases module (sidebar entry, settings page, routes).
   *
   * ⚠️ The KEY stays `milestones` forever, even though the module was
   * renamed to Releases. This is a REQUIRED key inside the
   * `projects.features` JSON column: renaming it leaves every existing row
   * missing a required key, and a missing required key does not read as
   * `undefined` and fall back — the whole row fails to decode and every
   * query touching `projects` throws. That is verbatim the 2026-08-05
   * incident (see CLAUDE.md, "Renaming a REQUIRED key inside a JSON column
   * takes production down"). Only the UI label moved to "Releases".
   */
  milestones: z.boolean(),
  /**
   * Per-quest feature toggles. All default OFF for new projects —
   * keeps the quest view minimal until the owner opts in. Plain
   * owner-controlled switches: the Shop that used to sell `questReminder`
   * was removed along with the gold economy, so the toggle is now the
   * only gate.
   *
   * The three are one family: `questEstimate` plans time, `questChrono`
   * tracks it, `questReminder` nudges about it. Each is a methodology a
   * project may or may not practise, so none is on by default.
   *
   * These gate the UI only. `quests.estimateMinutes` and the timer
   * columns keep being accepted, stored and returned whatever the switch
   * says — flipping one off hides existing data, it never deletes it.
   */
  questEstimate: z.boolean().optional(),
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
   * Reveal the "Summary for agents" field on a folio. Off by default: the
   * summary is written for `project_context` / `folio_list`, so for a human
   * reading a folio it is chrome between the title and the first line.
   *
   * Hiding it never stops it being persisted — MCP keeps writing it and
   * turning the switch back on shows the stored value unchanged.
   *
   * Optional and absent from `defaultProjectFeatures` for the same reason as
   * `sigils` above: a key there changes the column DEFAULT and triggers the
   * D1 `projects` rebuild that cascade-wipes prod.
   */
  folioSummary: z.boolean().optional(),
  /**
   * The Epics module switch. Optional and ABSENT from
   * `defaultProjectFeatures` for the same reason as `sigils` and
   * `folioSummary`: adding a key there changes the column DEFAULT and
   * triggers a D1 `projects` table rebuild that cascade-wipes members,
   * quests, releases, folios and feedback. Defaults to `false` via the
   * `useProjectFeatureToggle` hook.
   */
  epics: z.boolean().optional(),
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
 * Default feature flags. NB: the per-quest toggles (`questEstimate`,
 * `questReminder`, `questChrono`) are intentionally
 * absent from this object. Including them here changes the column's
 * Drizzle DEFAULT — and on D1 that triggers a table rebuild
 * (`DROP TABLE projects`) which cascade-wipes members, quests,
 * releases, folios, feedback. See CLAUDE.md "Migration safety on D1".
 *
 * They're optional in the schema and default to `false` via the
 * `useProjectFeatureToggle` hook (`persisted[key] ?? false`).
 */
export const defaultProjectFeatures: ProjectFeatures = {
  kanban: true,
  folios: true,
  feedback: true,
  // Reads "Releases" in the UI. The persisted key keeps its old name — see
  // `projectFeaturesSchema` above for why renaming it takes production down.
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
    /**
     * URL identity. Derived from `title` on create and on every rename by
     * `ProjectSlugService`, and unique across the whole instance because the
     * slug is a **root-level** path segment (`/sds/quests/19`).
     *
     * Declared `.optional()` with NO `db.default(...)` on purpose: a column
     * DEFAULT triggers the D1 `projects` table rebuild that cascade-wipes
     * members, quests, releases, folios and feedback. See CLAUDE.md
     * "Migration safety on D1". Optional is a physical-column fact only —
     * the backfill fills every live row and every write path sets it, so
     * readers may treat it as present.
     *
     * ⚠️ The charset rule lives on `projectTitleSchema`, applied by the
     * controller on write. It is deliberately NOT on `title` above: the
     * entity schema also decodes rows on READ, so tightening it there would
     * make every pre-existing title that violates the new rule fail to
     * decode — the same failure mode as the 2026-08-05 JSON-key incident.
     *
     * Cleared on soft-delete so a deleted project stops holding its name
     * hostage — SQLite treats NULLs as distinct in a UNIQUE index.
     */
    slug: z.string().optional(),
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
    /**
     * @deprecated Superseded by the `areas` table (2026-08-19). Nothing
     * reads or writes this. It stays in the schema because dropping a
     * `projects` column risks the D1 rebuild path, and `projects` is the
     * CASCADE parent that wiped production in 2026-05. Same treatment as
     * `public` / `unlockedFeatures` / `unlockHistory`.
     */
    areas: db.default(z.array(z.string()), []),
    features: db.default(projectFeaturesSchema, defaultProjectFeatures),
    /**
     * @deprecated Dead since the release recorder was deleted (2026-08-30).
     * It held an ISO 8601 duration (`"P14D"`, `"P1M"`) that computed a
     * milestone's auto-close deadline; nothing closes on a timer any more, so
     * nothing reads or writes it. The settings control that set it is gone.
     *
     * ⚠️ Kept, and keeping its pre-rename name, for the same reason as
     * `public` / `unlockedFeatures` / `unlockHistory`: `projects` is the
     * CASCADE parent that wiped production on 2026-05-13, and a rename or a
     * drop that drizzle turns into a table rebuild is that wipe bomb.
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
     * The Kanban board's configurable column NAMES, in order. Only
     * meaningful when `features.kanban` is on. Capped at 5 by the
     * controller. Default is a single "In Progress" lane so existing
     * accepted quests keep a coherent column to live in.
     *
     * Deliberately still a bare `string[]`. Quest #1227 needed each column
     * to carry a lifecycle state and #1228 needed a WIP limit, and both
     * live in `kanbanColumnConfig` below rather than turning this into an
     * array of objects — see that field for why.
     */
    kanbanColumns: db.default(
      z.array(z.string().min(1).max(24)).min(1).max(5),
      ["In Progress"],
    ),
    /**
     * Per-column settings, keyed by column name: which lifecycle state the
     * column collapses to, and its WIP limit.
     *
     * Absent, or absent for a given column, reproduces exactly the board
     * that existed before this column: `New | <every configured column,
     * accepted> | Completed`.
     *
     * NB: `z.optional` with NO `db.default(...)`, like `retentionDays`,
     * `defaultSurface` and `tagColors` above — a column DEFAULT triggers
     * the `projects` table rebuild that cascade-wipes children on D1.
     */
    kanbanColumnConfig: kanbanColumnConfigSchema.optional(),
    /**
     * Which surface bare `/:projectSlug` lands on: the grouped quest table
     * or the Kanban board. Absent means the table.
     *
     * Per-project rather than per-browser on purpose. This replaced
     * `questsViewAtom`, a cookie: a team that works kanban-first had to
     * rediscover the toggle on every machine, and an invited member
     * inherited nothing. The board being a real route (`/kanban`) is what
     * made a stored preference a redirect target rather than a rendering
     * mode.
     *
     * NB: `z.optional` with NO `db.default(...)`, for the same reason as
     * `retentionDays` above — a column DEFAULT triggers a `projects` table
     * rebuild on D1, and `projects` is the CASCADE parent that wiped
     * production on 2026-05-13. The "list" fallback lives in the index
     * route, not in the column.
     */
    defaultSurface: z.enum(["list", "kanban"]).optional(),
    /**
     * Colour token per quest tag, e.g. `{ "bug": "red", "chore": "slate" }`.
     * A tag with no entry renders neutral.
     *
     * Stored here rather than in a `tags` table because tags have no table:
     * `quests.tags` is a denormalized `string[]` with no identity of its
     * own, so a table would exist purely to hold a colour and would need a
     * rename path, a delete path and a backfill to earn it. A map on the
     * project is the smaller thing that answers the actual question, and an
     * entry for a tag nobody uses any more is inert rather than wrong.
     *
     * A hash of the tag name was rejected: it needs no storage, but the
     * moment anyone wants to change one colour it becomes a migration, and
     * the palette and its picker already exist for `areas.color`.
     *
     * NB: `z.optional` with NO `db.default(...)`, like `retentionDays` and
     * `defaultSurface` above — a column DEFAULT triggers the `projects`
     * table rebuild that cascade-wipes children on D1.
     */
    tagColors: z.record(z.text(), paletteColorSchema).optional(),
    /**
     * @deprecated — the gold Shop / feature paywall was removed. Every
     * feature it used to sell (Reports, Quest Reminder, Quest Gating)
     * is now either always-on or a plain owner toggle. No code reads or
     * writes these two columns.
     *
     * They are kept in the schema ON PURPOSE: dropping a column from
     * `projects` risks the Drizzle/D1 table-rebuild path, and `projects`
     * is a CASCADE parent of members/quests/releases/folios/feedback —
     * exactly the shape that wiped production on 2026-05-13. Same
     * treatment as the `public` column above. A future PR can drop them
     * with a hand-written, verified `ALTER TABLE ... DROP COLUMN`.
     */
    unlockedFeatures: db.default(z.array(z.string()), []),
    /**
     * @deprecated — see `unlockedFeatures`.
     */
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
    {
      columns: ["slug"],
      unique: true,
    },
  ],
});

export type Project = Infer<typeof projects.schema>;
