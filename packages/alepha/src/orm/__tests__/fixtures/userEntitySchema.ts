import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "../../core/index.ts";

export const userEntity = $entity({
  name: "users",
  schema: z.object({
    id: db.primaryKey(z.integer()),
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
export type UserEntity = Infer<typeof userEntity.schema>;
export type InsertUserEntity = Infer<typeof insertUserEntitySchema>;
