import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

/**
 * Per-user dashboard state that is not a card.
 *
 * It exists for exactly one fact, and that fact is load-bearing: **whether
 * this user's dashboard has ever been seeded.**
 *
 * "A user who has never opened the dashboard" and "a user who removed every
 * card" are the same database state — zero rows in `dashboard_cards` — unless
 * something else distinguishes them. A seeder keyed on "zero rows" resurrects
 * the default set every time someone empties their board, which is the one
 * thing an empty state must never do. `seededAt` is that marker: it is
 * stamped once, by the first list or resolve the user makes, and "Reset
 * layout" does not clear it.
 *
 * A row per user rather than a column on `users` because `users` belongs to
 * `alepha/api/users` — the framework's table, not Lore's.
 */
export const dashboardSettings = $entity({
  name: "dashboard_settings",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    userId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    /** When the default card set was first written for this user. */
    seededAt: z.string(),
  }),
  indexes: [{ columns: ["userId"], unique: true }],
});

export type DashboardSettings = Infer<typeof dashboardSettings.schema>;
