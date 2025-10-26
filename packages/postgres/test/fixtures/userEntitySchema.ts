import type { Static } from "@alepha/core";
import { t } from "@alepha/core";
import { $entity, pg, uniqueIndex } from "../../src";

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
  config: (table) => [uniqueIndex("name").on(table.name)],
});

export const insertUserEntitySchema = userEntity.insertSchema;
export type UserEntity = Static<typeof userEntity.schema>;
export type InsertUserEntity = Static<typeof insertUserEntitySchema>;
