import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { dashboardScopeSchema } from "../schemas/dashboardScopeSchema.ts";
import { projects } from "./projects.ts";

/**
 * One tile on one project's board.
 *
 * **Per project, not per user.** The board belongs to the project and every
 * member reads the same one: "look at the dashboard" has to mean something
 * between two people, which a private board about a shared project cannot.
 * Writing it is gated on `project:update`, so the owner and an Admin rank
 * curate it and a Contributor reads it.
 *
 * ## A second table rather than a nullable column on `dashboard_cards`
 *
 * Repointing `dashboard_cards` from `userId` to a nullable `projectId` would
 * be the smaller diff and the wrong one. Home is untouched by this epic and
 * has to keep working while this is built; changing an FK on D1 is a table
 * rebuild, and `apps/lore/CLAUDE.md` is unambiguous about what a `DROP TABLE`
 * does there. And the two boards stop being the same thing the moment the
 * configuration belongs to the project rather than to the reader — one table
 * would leave every query carrying a "which kind of board is this" branch.
 *
 * ## ⚠️ There is no seeding marker, and that is a ruling
 *
 * `dashboard_settings.seededAt` exists on home for one fact: "never opened"
 * and "emptied by hand" are the same zero rows there, and a seeder keyed on
 * zero rows resurrects the defaults every time somebody clears their board.
 * **Nothing seeds a project board** — it opens empty and the reader fills it
 * — so those two states are genuinely one state here and the distinction has
 * no reader. One table, not two. If a seeder is ever added, its marker
 * arrives with it as an additive `CREATE TABLE`.
 */
export const projectDashboardCards = $entity({
  name: "project_dashboard_cards",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The metric registry key.
     *
     * Plain text validated against `DashboardMetricCatalog`, deliberately not
     * a DB enum: an enum would make every new metric a migration, and on D1 a
     * column-constraint change is a table rebuild.
     */
    metric: z.string().min(1).max(64),
    /**
     * The tagged-union scope. See `dashboardScopeSchema`.
     *
     * Inside a project `all` is meaningless and `projects` carries exactly
     * one id — the route's, forced server-side, never taken from the body.
     * What stays genuinely useful is `apps` (a project has several
     * instances) and `epic` / `release`, reserved since epic #E4 and used
     * for the first time here.
     */
    scope: dashboardScopeSchema,
    /**
     * The metric's own filter values, validated against that metric's Zod
     * schema on write **and on read** — a card written before a metric's
     * filters changed must fail loudly or degrade to declared defaults,
     * never resolve against a half-understood config.
     */
    filters: db.default(z.record(z.text(), z.any()), {}),
    /**
     * Grid width in columns.
     *
     * ⚠️ **Shared, because the board is shared.** `dashboard_cards` keeps the
     * same two columns on the row and justifies it by their being
     * per-user-per-card, sharing a lifecycle with the configuration. That
     * justification expires here: these are the only two columns a per-user
     * layer would ever take, and nothing else would move with them. They stay
     * on the row because there is no per-user layer, not because they could
     * not be split from one.
     */
    size: db.default(z.integer().min(1).max(6), 1),
    /**
     * Ordering within the grid, ascending. Ties break on `id`. Shared, for
     * the same reason as {@link size}.
     */
    position: db.default(z.integer().min(0), 0),
    createdAt: db.createdAt(),
  }),
  indexes: [{ columns: ["projectId", "position"] }],
});

export type ProjectDashboardCard = Infer<typeof projectDashboardCards.schema>;
export type ProjectDashboardCardInsert = Infer<
  typeof projectDashboardCards.insertSchema
>;
