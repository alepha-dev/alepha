import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

export const projects = $entity({
  name: "projects",
  schema: t.object({
    id: pg.primaryKey(t.int()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    deletedAt: pg.deletedAt(),
    title: t.string({
      minLength: 3,
      maxLength: 24,
    }),
    createdBy: t.uuid(),
    public: t.optional(t.boolean()),
    packages: pg.default(t.array(t.string()), []),
  }),
});

export type Project = Static<typeof projects.schema>;
