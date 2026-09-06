import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { kanbanColumnConfigSchema } from "../schemas/kanbanColumnSchema.ts";
import { paletteColorSchema } from "../schemas/paletteColorSchema.ts";
import { roadmapVisibilitySchema } from "../schemas/roadmapVisibilitySchema.ts";

/**
 * ⚠️ **FROZEN. Nothing reads this, and nothing may start.** The live surface
 * is the `project_capabilities` table, four rows at most per project, read
 * through `ProjectSecurityService.capabilitiesOf` on the server and
 * `hasCapability` / `capabilityOption` in the browser. Epic #36 moved every
 * gate off this object; `test/project-features-frozen.spec.ts` is what keeps
 * it that way.
 *
 * ## Why the column stays on disk forever
 *
 * Dropping a column from `projects` is drizzle's table-rebuild path, and
 * `projects` is the `ON DELETE CASCADE` parent that wiped lore-production on
 * 2026-05-13 - `DROP TABLE projects` took members, quests, releases, folios
 * and feedback with it. So this joins `unlockedFeatures`, `unlockHistory`,
 * `public`, `areas`, `milestoneDuration` and `defaultSurface` as a frozen
 * dead column. `createProject` keeps writing `defaultProjectFeatures` into it
 * so every row on disk stays decodable by the schema that still describes it,
 * and `defaultProjectFeatures` itself must not change: it IS the column
 * DEFAULT, and changing a DEFAULT is the same rebuild.
 *
 * ## Why the keys can never be renamed either
 *
 * Four of them are REQUIRED `z.boolean()`, and a missing required key does not
 * read as `undefined` and fall back to false - the whole row fails to decode
 * and every query touching `projects` throws. That is verbatim the 2026-08-05
 * incident: the great rename renamed the table and the columns, left
 * `petitions` and `chapters` inside the JSON on all 54 existing rows, and took
 * production down on every project read minutes after deploy. It is why
 * Releases is stored as `milestones` here and why the capability option that
 * replaced it could finally be called `releases`: moving the storage is what
 * let the name move with it.
 *
 * ## What each key became
 *
 * | this key | its replacement |
 * | --- | --- |
 * | `kanban` | option `work.board` |
 * | `folios` | capability `knowledge` |
 * | `feedback` | capability `support` |
 * | `milestones` | option `work.releases` |
 * | `epics` | option `work.epics` |
 * | `questEstimate` / `questChrono` / `questReminder` | options `work.estimate` / `work.chrono` / `work.reminder` |
 * | `sigils` | capability `apps`, and its option `apps.track` |
 * | `quality` | nothing - Quality joined the Apps baseline and its Reports tab self-hides until a run exists |
 * | `folioSummary` | option `knowledge.agentSummary` |
 * | `blights` / `beacon` / `vitals` | per-app `sigils.kinds`, already dead since 2026-08-06 |
 *
 * @deprecated Read `project_capabilities` instead. This exists so old rows
 * decode, and for no other reason.
 */
export const projectFeaturesSchema = z.object({
  kanban: z.boolean(),
  folios: z.boolean(),
  feedback: z.boolean(),
  /**
   * ⚠️ The KEY stays `milestones` forever. See the block above: it is a
   * required key inside a JSON column, and renaming one of those is what took
   * production down on 2026-08-05.
   */
  milestones: z.boolean(),
  questEstimate: z.boolean().optional(),
  questReminder: z.boolean().optional(),
  questChrono: z.boolean().optional(),
  sigils: z.boolean().optional(),
  folioSummary: z.boolean().optional(),
  epics: z.boolean().optional(),
  quality: z.boolean().optional(),
  blights: z.boolean().optional(),
  beacon: z.boolean().optional(),
  vitals: z.boolean().optional(),
});

export type ProjectFeatures = Infer<typeof projectFeaturesSchema>;

/**
 * ⚠️ **This object IS the column DEFAULT. Changing it is the wipe bomb.**
 *
 * A key added or removed here changes drizzle's `DEFAULT` clause on
 * `projects.features`, which drizzle-kit expresses as a table rebuild -
 * `CREATE __new`, `INSERT FROM SELECT`, `DROP TABLE projects`, `RENAME` - and
 * D1 ignores `PRAGMA foreign_keys=OFF`, so the `DROP` cascades through
 * members, quests, releases, folios and feedback. That is not a hypothetical:
 * it is migration `0023_special_purifiers.sql`, 2026-05-13, which flipped
 * exactly these defaults and wiped lore-production. See CLAUDE.md, "Migration
 * safety on D1".
 *
 * It is why the four keys below are the only ones here, why every switch
 * added afterwards had to be `.optional()` with no default, and ultimately why
 * epic #36 moved capabilities to their own table: a bag that cannot grow is
 * not a place to keep configuration.
 *
 * `createProject` still stamps this on every new row so the row decodes
 * against {@link projectFeaturesSchema}, and nothing else writes it.
 *
 * @deprecated Frozen with the column. See {@link projectFeaturesSchema}.
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
    /**
     * @deprecated Frozen since epic #36 (2026-09-06). The live surface is the
     * `project_capabilities` table; see {@link projectFeaturesSchema} for what
     * each key became and why neither the column, its DEFAULT nor any key
     * inside it can ever change. Still WRITTEN by `createProject`, with
     * `defaultProjectFeatures` and nothing else, so every row stays decodable
     * - which is not a reason to read it.
     */
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
     * The repository this project's commits live in, as a full URL
     * (`https://github.com/alepha-dev/alepha`). Set it and a quest's commit
     * shas become links; leave it and they render as they always have.
     *
     * ⚠️ Deliberately permissive here and constrained on the way in, the same
     * split `title` uses: `projectRepositoryUrlSchema` is what refuses a bare
     * `owner/repo`, a query string or a trailing slash, and it runs on write
     * only. A stored value must always load.
     *
     * One URL rather than a slug and a provider, because one project is one
     * repository (2026-08-29). `quests.commits[].repo` stays stored and
     * accepted - existing rows carry it and it is public MCP surface - but
     * the link is built from this alone.
     */
    repositoryUrl: z.string().max(200).optional(),
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
     * meaningful when the `work.board` option is on. Capped at 5 by the
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
     * @deprecated Frozen dead column since 2026-09-02 (feedback #2066).
     *
     * It held which surface a bare `/:projectSlug` landed on, the list or
     * the Kanban board, and drove a redirect in the index route's loader.
     * The "Open on the board" setting and that redirect are gone; nothing
     * reads or writes this any more, and a bare project URL always lands
     * on the list.
     *
     * Kept declared, still `z.optional` with no `db.default(...)`, because
     * dropping a column on `projects` is the D1 table rebuild that
     * cascade-wipes its children (2026-05-13). Same treatment as
     * `unlockedFeatures` and `milestoneDuration`.
     */
    defaultSurface: z.enum(["list", "kanban"]).optional(),
    /**
     * Who may read this project's roadmap at `/:projectSlug/roadmap`.
     * Absent means `off`.
     *
     * A dedicated column rather than a key in `features` on purpose. A
     * tri-state does not fit a boolean bag, and `projectFeaturesSchema`'s
     * required keys cannot be renamed while adding one to
     * `defaultProjectFeatures` changes the column DEFAULT - which is the D1
     * `projects` rebuild that cascade-wipes children. A separate column is
     * both cheaper and safer.
     *
     * NB: `z.optional` with NO `db.default(...)`, for the same reason as
     * `retentionDays` and `defaultSurface` above. The `off` fallback lives in
     * `ProjectSecurityService.roadmapVisibilityOf`, not in the column.
     */
    roadmapVisibility: roadmapVisibilitySchema.optional(),
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
