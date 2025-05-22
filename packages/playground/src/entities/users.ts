import { t } from "@alepha/core";
import { $entity, pg } from "@alepha/postgres";

export const users = $entity({
	name: "users",
	schema: t.object({
		id: pg.primaryKey(t.uuid()),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		version: pg.version(),
		email: t.string(),
		password: t.string(),
	}),
});
