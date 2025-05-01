import { t } from "@alepha/core";
import { pg, table } from "@alepha/postgres";

export const users = table(
	"users",
	t.object({
		id: pg.primaryKey(t.uuid()),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		version: pg.version(),
		email: t.string(),
		firstName: t.string(),
		lastName: t.string(),
	}),
);
