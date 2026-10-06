import { type Infer, z } from "alepha";
import { organizations } from "alepha/api/organizations";
import { $entity, db } from "alepha/orm";

import { kanbanColumnConfigSchema } from "../schemas/kanbanColumnSchema.ts";
import { paletteColorSchema } from "../schemas/paletteColorSchema.ts";
import { roadmapVisibilitySchema } from "../schemas/roadmapVisibilitySchema.ts";

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
    organizationId: db.ref(z.uuid().optional(), () => organizations.cols.id, {
      onDelete: "restrict",
    }),
    icon: z.uuid().optional(),
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
     * NB: `z.optional` with NO `db.default(...)`, like `retentionDays` and
     * `tagColors` — a column DEFAULT triggers
     * the `projects` table rebuild that cascade-wipes children on D1.
     */
    kanbanColumnConfig: kanbanColumnConfigSchema.optional(),
    /**
     * Who may read this project's roadmap at `/:projectSlug/roadmap`.
     * Absent means `off`.
     *
     * A dedicated column, not an option of a capability: it is a tri-state
     * and it belongs to the project, not to one surface.
     *
     * NB: `z.optional` with NO `db.default(...)`, for the same reason as
     * `retentionDays` above. The `off` fallback lives in
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
     * NB: `z.optional` with NO `db.default(...)`, like `retentionDays`
     * above — a column DEFAULT triggers the `projects`
     * table rebuild that cascade-wipes children on D1.
     */
    tagColors: z.record(z.text(), paletteColorSchema).optional(),
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
