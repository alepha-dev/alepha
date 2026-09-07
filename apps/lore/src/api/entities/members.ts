import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";

/**
 * Project membership. One row per (user, project) pair — nothing more.
 * Identity (name, picture) always comes from the user account; the old
 * per-project character progression (xp, balance, achievements, titles,
 * alias, picture) was removed in the 2026-07 de-gamification pass.
 */
export const members = $entity({
  name: "members",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    userId: db.ref(z.uuid(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),

    /**
     * @deprecated Read nothing off this. Use {@link rank}.
     *
     * Frozen rather than dropped, like every other retired column in this app.
     * `members` has no children so a rebuild would cascade-wipe nothing and a
     * DROP would be defensible, but the convention is worth more than the
     * column.
     *
     * ⚠️ **Its database default is `true`, and that cannot be changed** - a
     * default on this table is a table rebuild. So its two writers
     * (`createProject` writing `true`, `ProjectInvitationResource.grant`
     * writing `false`) stay live until the last reader is gone: dropping the
     * `false` write while the members list still reads the column would make
     * every newly accepted invitation render as an owner, in production, with
     * no human gate between here and the deploy. #Q1997 removes them.
     */
    owner: db.default(z.boolean(), true),

    /**
     * Which rank this member holds in this project.
     *
     * **One rank per member**, which is exactly what makes the read free: it
     * rides the membership row `$owns` already loads and memoizes, so a
     * project member's permission set costs zero extra queries.
     *
     * `.optional()` with **no database default**, the established pattern in
     * this app: a default on `members` is a table rebuild, and a NULL reads as
     * the built-in `member` rank. Writing the word `member` into every row
     * would touch every membership for no gain and freeze today's default into
     * data.
     *
     * ⚠️ **Exactly one `owner` per project is enforced in code, not by a
     * partial unique index.** The ORM supports one, and it was the obvious
     * way to make it a database fact. It is rejected because D1 has no
     * transactions and SQLite checks UNIQUE per row while a statement runs, so
     * a one-statement ownership transfer could trip it mid-statement depending
     * on row order. The backfill produces one, the assignment endpoint refuses
     * `owner`, and the transfer is a single UPDATE.
     */
    rank: z.text({ maxLength: 64 }).optional(),
  }),
  indexes: [
    {
      columns: ["userId", "projectId"],
      unique: true,
    },
  ],
});

export type Member = Infer<typeof members.schema>;
