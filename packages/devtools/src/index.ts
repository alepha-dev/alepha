import { $module } from "alepha";
import { DevToolsProvider } from "./api/DevToolsProvider.ts";
import { DevToolsDatabaseProvider } from "./api/providers/DevToolsDatabaseProvider.ts";
import { DevToolsMetadataProvider } from "./api/providers/DevToolsMetadataProvider.ts";
import { LogRepository } from "./api/repositories/LogRepository.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./api/providers/DevToolsMetadataProvider.ts";
export * from "./api/schemas/DevActionMetadata.ts";
export * from "./api/schemas/DevBucketMetadata.ts";
export * from "./api/schemas/DevCacheMetadata.ts";
export * from "./api/schemas/DevCommandMetadata.ts";
export * from "./api/schemas/DevEntityMetadata.ts";
export * from "./api/schemas/DevMetadata.ts";
export * from "./api/schemas/DevModuleMetadata.ts";
export * from "./api/schemas/DevPageMetadata.ts";
export * from "./api/schemas/DevProviderMetadata.ts";
export * from "./api/schemas/DevQueueMetadata.ts";
export * from "./api/schemas/DevRealmMetadata.ts";
export * from "./api/schemas/DevRouteMetadata.ts";
export * from "./api/schemas/DevSchedulerMetadata.ts";
export * from "./api/schemas/DevTopicMetadata.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | tooling | rare | experimental |
 *
 * Runtime inspection and debugging UI.
 *
 * **Features:**
 * - DevTools UI at `GET /devtools`
 * - Application metadata at `GET /devtools/metadata`
 * - Last 10,000 logs at `GET /devtools/logs`
 * - Runtime inspection of actions, queues, schedulers, topics, buckets
 * - Log viewer with filtering
 * - React Flow visualization
 * - Provider and module browsing
 *
 * @module alepha.devtools
 */
export const AlephaDevtools = $module({
  name: "alepha.devtools",
  primitives: [],
  services: [
    DevToolsMetadataProvider,
    DevToolsProvider,
    DevToolsDatabaseProvider,
    LogRepository,
  ],
  register: (alepha) => {
    alepha.with(DevToolsProvider);
    alepha.with(DevToolsDatabaseProvider);
    alepha.with(DevToolsMetadataProvider);
    alepha.store.push("alepha.build.assets", "@alepha/devtools");
  },
});
