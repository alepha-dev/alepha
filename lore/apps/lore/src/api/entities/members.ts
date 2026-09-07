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
     * @deprecated Read nothing off this, and write nothing to it. Use
     * {@link rank}.
     *
     * ⚠️ **Every row written from now on says `true`, and that means nothing.**
     * The column's database DEFAULT is `true` and cannot be changed (a default
     * on this table is a table rebuild, which this app does not do), so with
     * the last writer gone the default is what fills it. A future reader must
     * not conclude from a table full of `true` that a project has many owners:
     * the answer is {@link rank}, and there is exactly one `owner` per
     * project.
     *
     * Nothing reads it. #Q1997 removed the last two writers - `createProject`
     * wrote `true`, `ProjectInvitationResource.grant` wrote `false` - and it
     * could only run once the readers were gone: dropping the `false` write
     * while the members list still read the column would have rendered every
     * newly accepted invitation as an owner, in production, with no human gate
     * between here and the deploy.
     *
     * Frozen rather than dropped, like every other retired column in this app.
     * `members` has no children so a rebuild would cascade-wipe nothing and a
     * DROP would be defensible, but the convention is worth more than the
     * column.
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
