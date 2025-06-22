import type { Static } from "@alepha/core";
import { t } from "@alepha/core";
import { pg, pgTableSchema, uniqueIndex } from "../../src";

export const userEntitySchema = pg.entity({
	name: t.string(),
	profile: t.object({
		age: t.number(),
	}),
	role: pg.default(t.string(), "user"),
});

export const insertUserEntitySchema = pg.insert(userEntitySchema);
export type UserEntity = Static<typeof userEntitySchema>;
export type InsertUserEntity = Static<typeof insertUserEntitySchema>;

export const userEntity = pgTableSchema("user", userEntitySchema, (table) => [
	uniqueIndex("name").on(table.name),
]);
