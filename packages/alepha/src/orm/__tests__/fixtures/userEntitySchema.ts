import type { Static } from "alepha";
import { t } from "alepha";
import { $entity, db } from "../../index.ts";

export const userEntity = $entity({
  name: "users",
  schema: t.object({
    id: db.primaryKey(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    name: t.text(),
    profile: t.object({
      age: t.number(),
    }),
    role: db.default(t.text(), "user"),
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
