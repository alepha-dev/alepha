import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

/**
 * Per-user dashboard state that is not a card.
 *
 * It exists for exactly one fact, and that fact is load-bearing: **whether
 * this user's HOME dashboard has ever been seeded.**
 *
 * "A user who has never opened the dashboard" and "a user who removed every
 * card" are the same database state — zero rows in `dashboard_cards` — unless
 * something else distinguishes them. A seeder keyed on "zero rows" resurrects
 * the default set every time someone empties their board, which is the one
 * thing an empty state must never do. `seededAt` is that marker: it is
 * stamped once, by the first list the user makes, and nothing clears it.
 *
 * ⚠️ **It is not Reset's column, and Reset is gone** (#Q2145). The comment
 * here used to explain the marker through that button, which made it look
 * like the button's state; it is not, and the marker outlives it. What keeps
 * it necessary is that home DOES seed on first read.
 *
 * ⚠️ **A project board has no equivalent, on purpose.** Nothing seeds one, so
 * "never opened" and "emptied by hand" are genuinely the same state there and
 * the distinction has no reader — see `projectDashboardCards`. The two tables
 * differ here deliberately.
 *
 * A row per user rather than a column on `users` because `users` belongs to
 * `alepha/api/users` — the framework's table, not Lore's.
 */
export const dashboardSettings = $entity({
  name: "dashboard_settings",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    userId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    /**
     * When the default card set was first written for this user.
     */
    seededAt: z.string(),
  }),
  indexes: [{ columns: ["userId"], unique: true }],
});

export type DashboardSettings = Infer<typeof dashboardSettings.schema>;
