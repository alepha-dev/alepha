import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";

export const categoryEntity = $entity({
  name: "categories",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    name: t.text({ minLength: 1, maxLength: 100 }),
    slug: t.text({ minLength: 1, maxLength: 120 }),
    description: t.optional(t.text({ maxLength: 500 })),
    color: t.optional(t.text()),
  }),
  indexes: [{ column: "slug", unique: true }],
});

export type CategoryEntity = Static<typeof categoryEntity.schema>;
