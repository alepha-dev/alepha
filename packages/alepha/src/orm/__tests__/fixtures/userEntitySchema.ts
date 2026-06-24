import type { Static } from "alepha";
import { z } from "alepha";
import { $entity, db } from "../../core/index.ts";

export const userEntity = $entity({
  name: "users",
  schema: z.object({
    id: db.primaryKey(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    name: z.text(),
    profile: z.object({
      age: z.number(),
    }),
    role: db.default(z.text(), "user"),
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
