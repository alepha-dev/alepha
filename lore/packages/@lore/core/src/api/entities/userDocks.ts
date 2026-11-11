import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

/**
 * Each person's dock: the projects they pinned to the project rail, in the
 * order they put them there (#E139, #Q3434).
 *
 * ## One row per user, the order as an array
 *
 * Not a column on `organization_members` nor on `users`: both are framework
 * entities (`alepha/api/organizations`, `alepha/api/users`), and a pin is a
 * Lore preference. A row per pin would make a reorder N writes, and D1 has no
 * transaction to keep them together; here a reorder is one row write and the
 * cap is the array's length.
 *
 * ## ⚠️ The row existing means "seeded"
 *
 * A user with no row is seeded once, on their first read, from the rail they
 * had before (`UserDockService.seed`). An emptied dock is a row with `[]`,
 * and stays empty: it is never seeded again.
 *
 * ## The ids are not foreign keys
 *
 * A JSON array cannot carry one. A project that is deleted, archived or left
 * stays in the array until something removes it; every read drops the ids
 * that are no longer a live membership, so none of them is ever drawn.
 */
export const userDocks = $entity({
  name: "user_docks",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    /**
     * A real foreign key: deleting the account deletes its dock.
     */
    userId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    /**
     * The pinned project ids, in dock order, top first.
     */
    projectIds: db.default(z.array(z.integer()), []),
    /**
     * When the row was seeded from the old rail. Informational: the row's
     * existence is what says the seed happened.
     */
    seededAt: z.datetime(),
  }),
  indexes: [{ columns: ["userId"], unique: true }],
});

export type UserDock = Infer<typeof userDocks.schema>;
