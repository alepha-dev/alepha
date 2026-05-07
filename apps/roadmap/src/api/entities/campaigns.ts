import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";

export const campaigns = $entity({
  name: "campaigns",
  schema: t.object({
    id: db.primaryKey(t.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
    title: t.string({
      minLength: 3,
      maxLength: 24,
    }),
    createdBy: t.uuid(),
    public: t.optional(t.boolean()),
    whiteboard: t.optional(t.boolean()),
    zones: db.default(t.array(t.string()), []),
  }),
  indexes: [
    {
      columns: ["createdBy"],
    },
  ],
});

export type Campaign = Static<typeof campaigns.schema>;
