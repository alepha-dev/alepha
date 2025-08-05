import { $hook, type Static, t } from "@alepha/core";
import { $entity, $repository, pg } from "@alepha/postgres";

export const tasks = $entity({
	name: "tasks",
	schema: t.object({
		id: pg.primaryKey(t.int()),
		title: t.string(),
		description: t.string({ size: "rich" }),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		package: t.string(),
		priority: t.enum(["optional", "low", "medium", "high"]),
		complexity: t.int({ minimum: 1, maximum: 5 }),
		completedAt: t.optional(t.datetime()),
	}),
});

export type Task = Static<typeof tasks.$schema>;
export type TaskInsert = Static<typeof tasks.$insertSchema>;

export class Db {
	tasks = $repository(tasks);

	ready = $hook({
		on: "ready",
		handler: async () => {},
	});
}
