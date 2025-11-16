import type { Static } from "alepha/core";
import { t } from "alepha/core";
import { $entity, pg } from "alepha/orm";

export const userEntity = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    name: t.text(),
    profile: t.object({
      age: t.number(),
    }),
    role: pg.default(t.text(), "user"),
  }),
  indexes: [
    {
      column: "name",
      unique: true,
    },
  ],
});

export const insertUserEntitySchema = userEntity.insertSchema;
export type UserEntity = Static<typeof userEntity.schema>;
export type InsertUserEntity = Static<typeof insertUserEntitySchema>;
