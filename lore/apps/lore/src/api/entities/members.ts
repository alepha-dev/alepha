import { type Static, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";

/**
 * Campaign membership. One row per (user, campaign) pair — nothing more.
 * Identity (name, picture) always comes from the user account; the old
 * per-campaign character progression (xp, balance, achievements, titles,
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
    campaignId: db.ref(z.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    owner: db.default(z.boolean(), true),
  }),
  indexes: [
    {
      columns: ["userId", "campaignId"],
      unique: true,
    },
  ],
});

export type Member = Static<typeof members.schema>;
