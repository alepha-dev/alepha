import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";

export const projects = $entity({
  name: "projects",
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
    packages: db.default(t.array(t.string()), []),
  }),
  indexes: [
    {
      columns: ["createdBy"],
    },
  ],
});

export type Project = Static<typeof projects.schema>;
