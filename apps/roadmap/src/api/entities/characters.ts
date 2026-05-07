import { type Static, t } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";

export const characters = $entity({
  name: "characters",
  schema: t.object({
    id: db.primaryKey(t.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    userId: db.ref(t.uuid(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    campaignId: db.ref(t.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    xp: t.integer(),
    balance: db.default(t.integer(), 0),
    owner: db.default(t.boolean(), true),
  }),
  indexes: [
    {
      columns: ["userId", "campaignId"],
      unique: true,
    },
  ],
});

export type Character = Static<typeof characters.schema>;
