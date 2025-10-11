import { type Static, t } from "@alepha/core";
import { $entity, pg } from "@alepha/postgres";

export const notifications = $entity({
	name: "notifications",
	schema: t.object({
		id: pg.primaryKey(t.uuid()),
		version: pg.version(),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
	}),
});

export type NotificationEntity = Static<typeof notifications.$schema>;
