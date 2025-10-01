import { type Static, t } from "@alepha/core";
import { devActionMetadataSchema } from "./DevActionMetadata.ts";
import { devBucketMetadataSchema } from "./DevBucketMetadata.ts";
import { devCacheMetadataSchema } from "./DevCacheMetadata.ts";
import { devLogEntrySchema } from "./DevLogEntry.ts";
import { devPageMetadataSchema } from "./DevPageMetadata.ts";
import { devQueueMetadataSchema } from "./DevQueueMetadata.ts";
import { devRealmMetadataSchema } from "./DevRealmMetadata.ts";
import { devSchedulerMetadataSchema } from "./DevSchedulerMetadata.ts";
import { devTopicMetadataSchema } from "./DevTopicMetadata.ts";

export const devMetadataSchema = t.object({
	logs: t.array(devLogEntrySchema),
	actions: t.array(devActionMetadataSchema),
	queues: t.array(devQueueMetadataSchema),
	schedulers: t.array(devSchedulerMetadataSchema),
	topics: t.array(devTopicMetadataSchema),
	buckets: t.array(devBucketMetadataSchema),
	realms: t.array(devRealmMetadataSchema),
	caches: t.array(devCacheMetadataSchema),
	pages: t.array(devPageMetadataSchema),
	// More metadata will be added here later
});

export type DevMetadata = Static<typeof devMetadataSchema>;
