import { t } from "@alepha/core";
import { $table, pg } from "@alepha/postgres";

export const users = $table(
	"users",
	t.object({
		id: pg.primaryKey(t.uuid()),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		version: pg.version(),
		email: t.string(),
		password: t.string(),
	}),
);
