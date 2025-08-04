import { $hook, type Static, t } from "@alepha/core";
import { $entity, $repository, pg } from "@alepha/postgres";

export const tasks = $entity({
	name: "tasks",
	schema: t.object({
		id: pg.primaryKey(t.int()),
		title: t.string(),
		description: t.string({ size: "long" }),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		package: t.enum([
			"docs",
			"roadmap",
			"alepha",
			"batch",
			"bucket",
			"bucket-azure",
			"cache",
			"cache-redis",
			"cli",
			"command",
			"core",
			"datetime",
			"file",
			"lock",
			"lock-redis",
			"postgres",
			"protobuf",
			"queue",
			"queue-redis",
			"react",
			"react-auth",
			"react-flex",
			"react-form",
			"react-head",
			"react-i18n",
			"redis",
			"retry",
			"router",
			"scheduler",
			"security",
			"server",
			"server-cache",
			"server-compress",
			"server-cookies",
			"server-cors",
			"server-health",
			"server-helmet",
			"server-links",
			"server-metrics",
			"server-multipart",
			"server-proxy",
			"server-rate-limit",
			"server-security",
			"server-static",
			"server-swagger",
			"testing",
			"topic",
			"topic-redis",
			"vite",
			"other",
		]),
		priority: t.enum(["low", "medium", "high"]),
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
