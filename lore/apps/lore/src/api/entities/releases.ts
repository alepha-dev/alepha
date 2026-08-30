import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { releaseChangelogGroupSchema } from "../schemas/releaseChangelogGroupSchema.ts";
import { projects } from "./projects.ts";

/**
 * A named goal that holds the epics and quests due to ship in it.
 *
 * **Two states, and no `status` column.** `open` is `releasedAt IS NULL` and
 * `released` is `releasedAt IS NOT NULL`. A status column would let a row claim
 * to be open while carrying a release date, a bug that cannot exist if the
 * column does not; `quests` already works this way with
 * `acceptedAt` / `completedAt` / `shelvedAt`. A third state later is a plain
 * additive `ADD COLUMN`, added knowing what it is for.
 *
 * **A hotfix is not a state.** It is a new release: `0.28.1` created beside
 * `1.0.0`, quests attached, published, and `1.0.0` untouched. That is why
 * nothing here pauses and why N releases are open at once.
 *
 * ⚠️ `releases` is a RECYCLED table name. A table called `releases` existed
 * until 2026-08-05 and meant a *deploy*: created in
 * `20260803133023_tearful_drax`, renamed to `deployments` in
 * `20260805145510_lively_payback`. Migration history therefore contains two
 * unrelated `releases`; the one this entity maps to is the former
 * `milestones` table, renamed in the Lore Release epic.
 */
export const releases = $entity({
  name: "releases",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Per-project sequence. The internal reference AND the sort key: lists are
     * ordered by this, **never by `tag`**, because semver does not sort as
     * text and `0.10.0` would come before `0.9.0`.
     */
    number: z.integer().min(1),
    /**
     * `"0.28.0"`, `"demo-1"`. The release's identity, its URL segment, and the
     * future join key to `artifacts.tag`.
     *
     * ⚠️ Nullable at the column and REQUIRED in the create schema. Declaring
     * it `NOT NULL` would force a column `DEFAULT` (SQLite's
     * `ADD COLUMN NOT NULL` demands one), and the rule here is that
     * constraints live on the way in. Deliberately permissive at 100 too: the
     * real bound is `RELEASE_TAG_MAX_LENGTH` (64) on the way in. See
     * `releaseTagSchema.ts` for why tightening a column later is the hazard.
     */
    tag: z.string().max(100).optional(),
    /**
     * Kept separate from `tag` on purpose. The tag is the join key to
     * artifacts; a typo in a display name must not silently break that link.
     */
    title: z.string().min(1).max(100),
    description: db.default(z.string().meta({ size: "rich" }), ""),
    /**
     * When this release is *meant* to ship. An estimate and nothing more:
     * nothing enforces it and no cron reads it. That is the whole difference
     * from the auto-close deadline the milestone recorder carried.
     */
    targetDate: z.datetime().optional(),
    /**
     * Null means open. Publishing is a one-way door: it stamps this, freezes
     * `changelog` and the four counts below, and `updateRelease` / attach /
     * detach all refuse afterwards. `reopenRelease` is the single deliberate
     * way back.
     */
    releasedAt: z.datetime().optional(),
    /**
     * Markdown snapshot rendered at publish time. While the release is open
     * the changelog is computed live from its contents.
     */
    changelog: z.string().meta({ size: "rich" }).optional(),
    /**
     * The same changelog in structured form, frozen alongside the markdown.
     *
     * ⚠️ It exists so BOTH projections freeze together. The recorder froze
     * the markdown and recomputed the rows on every read, so a quest edited
     * after the close showed a different title in the page than in the
     * downloadable `.md`. A released release is immutable and renders
     * entirely from its own row, so the rows are stored rather than derived.
     *
     * Optional with NO `db.default`, so the migration is a plain additive
     * `ALTER TABLE ADD COLUMN`.
     */
    changelogGroups: z.array(releaseChangelogGroupSchema).optional(),
    /**
     * The progress rollup, FROZEN at publish and never recomputed after.
     *
     * A released release renders entirely from its own row, with no live
     * query at all. Otherwise completing a quest a month after `0.28.0`
     * shipped would silently rewrite what `0.28.0` shipped — exactly the
     * dishonesty the frozen changelog exists to prevent.
     *
     * The four buckets are disjoint by construction, so a reader derives the
     * untouched remainder as `total - completed - inProgress - shelved`:
     * `shelvedAt` is only ever set on a quest still in `new` status, so it
     * never coexists with `acceptedAt` or `completedAt`, and `inProgress`
     * excludes both of the others.
     */
    completed: z.integer().optional(),
    inProgress: z.integer().optional(),
    shelved: z.integer().optional(),
    total: z.integer().optional(),
  }),
  indexes: [
    { columns: ["projectId"] },
    { columns: ["projectId", "number"], unique: true },
    { columns: ["projectId", "tag"], unique: true },
  ],
});

export type Release = Infer<typeof releases.schema>;
