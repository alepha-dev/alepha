import { type Static, t } from "@alepha/core";

export const devSchedulerMetadataSchema = t.object({
	name: t.string(),
	description: t.optional(t.string()),
	cron: t.optional(t.string()),
	interval: t.optional(t.any()),
	lock: t.optional(t.boolean()),
});

export type DevSchedulerMetadata = Static<typeof devSchedulerMetadataSchema>;
