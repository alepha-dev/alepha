import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";
import { dashboardScopeSchema } from "../schemas/dashboardScopeSchema.ts";

/**
 * One tile on one user's dashboard.
 *
 * **Per user, not per project.** The dashboard is the logged-in landing page
 * and spans projects — the header greets the account and the first chip on
 * most cards reads "all projects".
 *
 * There was nowhere else to put this. `users` carries no preferences column,
 * and the cookie-atom pattern (`questsViewAtom`) is sized for a two-state UI
 * preference, not ten cards each carrying a scope and a filter set.
 *
 * `size` and `position` sit on the same row as the configuration rather than
 * in a separate layout table: both are per-user-per-card, they share a
 * lifecycle, and splitting them buys a join for nothing.
 */
export const dashboardCards = $entity({
  name: "dashboard_cards",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    userId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    /**
     * The metric registry key.
     *
     * Plain text validated against `DashboardMetricCatalog`, deliberately not
     * a DB enum: an enum would make every new metric a migration, and on D1
     * a column-constraint change is a table rebuild.
     */
    metric: z.string().min(1).max(64),
    /** The tagged-union scope. See `dashboardScopeSchema`. */
    scope: dashboardScopeSchema,
    /**
     * The metric's own filter values, validated against that metric's Zod
     * schema on write **and on read** — a card written before a metric's
     * filters changed must fail loudly or degrade to defaults, never resolve
     * against a half-understood config.
     */
    filters: db.default(z.record(z.text(), z.any()), {}),
    /** Grid width in columns. The mockup's Page Views card spans 2. */
    size: db.default(z.integer().min(1).max(6), 1),
    /** Ordering within the grid, ascending. Ties break on `id`. */
    position: db.default(z.integer().min(0), 0),
    createdAt: db.createdAt(),
  }),
  indexes: [{ columns: ["userId", "position"] }],
});

export type DashboardCard = Infer<typeof dashboardCards.schema>;
export type DashboardCardInsert = Infer<typeof dashboardCards.insertSchema>;
