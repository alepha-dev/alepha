import { type Static, t } from "alepha";
import { devActionMetadataSchema } from "./DevActionMetadata.ts";
import { devAtomMetadataSchema } from "./DevAtomMetadata.ts";
import { devBucketMetadataSchema } from "./DevBucketMetadata.ts";
import { devCacheMetadataSchema } from "./DevCacheMetadata.ts";
import { devCommandMetadataSchema } from "./DevCommandMetadata.ts";
import { devEntityMetadataSchema } from "./DevEntityMetadata.ts";
import { devEnvMetadataSchema } from "./DevEnvMetadata.ts";
import { devModuleMetadataSchema } from "./DevModuleMetadata.ts";
import { devPageMetadataSchema } from "./DevPageMetadata.ts";
import { devProviderMetadataSchema } from "./DevProviderMetadata.ts";
import { devQueueMetadataSchema } from "./DevQueueMetadata.ts";
import { devRealmMetadataSchema } from "./DevRealmMetadata.ts";
import { devRouteMetadataSchema } from "./DevRouteMetadata.ts";
import { devSchedulerMetadataSchema } from "./DevSchedulerMetadata.ts";
import { devTopicMetadataSchema } from "./DevTopicMetadata.ts";

export const devMetadataSchema = t.object({
  actions: t.array(devActionMetadataSchema),
  queues: t.array(devQueueMetadataSchema),
  schedulers: t.array(devSchedulerMetadataSchema),
  topics: t.array(devTopicMetadataSchema),
  buckets: t.array(devBucketMetadataSchema),
  realms: t.array(devRealmMetadataSchema),
  caches: t.array(devCacheMetadataSchema),
  pages: t.array(devPageMetadataSchema),
  providers: t.array(devProviderMetadataSchema),
  modules: t.array(devModuleMetadataSchema),
  entities: t.array(devEntityMetadataSchema),
  commands: t.array(devCommandMetadataSchema),
  routes: t.array(devRouteMetadataSchema),
  envs: t.array(devEnvMetadataSchema),
  atoms: t.array(devAtomMetadataSchema),
});

export type DevMetadata = Static<typeof devMetadataSchema>;
