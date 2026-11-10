import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";

/**
 * One named board of a project (#E127, #Q3298). A project holds several, and
 * every `project_dashboard_cards` row belongs to one.
 *
 * **Per project, never per member**: the ruling written on
 * `projectDashboardCards` holds for the dashboard as for its cards.
 *
 * ## Lazy, not eager
 *
 * A project has no row here until something needs one. With none it has one
 * implicit first dashboard, which is what every project had before this
 * table. The row is created by the backfill of the migration that made this
 * table, or by the first write that needs it: Customize, the first card
 * added, a rename, or the creation of a second dashboard
 * (`ProjectDashboardCardService.firstForWrite`).
 *
 * Eager cannot hold. Several paths insert a project directly (the create
 * route, `createTestProject`, the Deploy specs), and the previous Worker keeps
 * serving for a few seconds after a migration ran (`apps/lore/AGENTS.md`,
 * "The migrate-before-deploy window is accepted"), so every read has to
 * tolerate "no row" anyway.
 *
 * ## "First" is positional
 *
 * The first dashboard is the one with the lowest {@link position}, ties on
 * `id`. There is no `isDefault` column. A card whose `dashboardId` is null
 * belongs to its project's first dashboard, permanently: that is a read rule,
 * not a transition, because the previous Worker can still write such a card
 * in the deploy window.
 *
 * ## ⚠️ Columns are only ever added to
 *
 * Cards reference this table with `ON DELETE CASCADE`, which makes it a
 * cascade parent: `test/migration-safety.spec.ts` refuses any later rebuild
 * of it, and on D1 a rebuild of a parent cascade-wipes its children. So: no
 * DB enum and no column default beyond `createdAt`'s, ever, since adding or
 * changing either is a rebuild. A new column arrives optional, with no
 * default, as a plain `ADD COLUMN`.
 */
export const projectDashboards = $entity({
  name: "project_dashboards",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * What the selector shows. Absent on the first dashboard nobody named:
     * the backfill and the lazy creation write none, and the screen shows the
     * localized `project.menu.dashboard` label, since a literal written by a
     * migration would be English for a French reader.
     */
    name: z.string().min(1).max(60).optional(),
    /**
     * The URL segment, derived from {@link name}, unique in the project.
     * Absent with the name; such a dashboard reads as `dashboard-<id>`
     * should it ever need one.
     */
    slug: z.string().min(1).max(80).optional(),
    /**
     * Ordering, ascending, ties on `id`. Written once, at creation, after the
     * project's last: order is creation order, and nothing moves a dashboard
     * yet. The column stays so that reordering can arrive with no migration.
     */
    position: z.integer().min(0),
    createdAt: db.createdAt(),
  }),
  indexes: [
    { columns: ["projectId", "slug"], unique: true },
    { columns: ["projectId", "position"] },
  ],
});

export type ProjectDashboard = Infer<typeof projectDashboards.schema>;
