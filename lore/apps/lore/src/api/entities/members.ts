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
    owner: db.default(z.boolean(), true),
  }),
  indexes: [
    {
      columns: ["userId", "projectId"],
      unique: true,
    },
  ],
});

export type Member = Infer<typeof members.schema>;
