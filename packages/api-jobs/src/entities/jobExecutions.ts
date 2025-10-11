import { type Static, t } from "@alepha/core";
import { $entity, pg } from "@alepha/postgres";

export const jobExecutions = $entity({
	name: "job_executions",
	schema: t.object({
		id: pg.primaryKey(t.uuid()),
		version: pg.version(),
		createdAt: pg.createdAt(),
		updatedAt: pg.updatedAt(),
		log: t.optional(t.string()),
		finishedAt: t.optional(t.datetime()),
		job: t.string(),
		status: t.enum(["pending", "running", "failed", "completed"]),
	}),
});

export type JobExecutionEntity = Static<typeof jobExecutions.$schema>;
