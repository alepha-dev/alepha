import { $module } from "@alepha/core";
import { DevToolsDatabaseProvider } from "./providers/DevToolsDatabaseProvider.ts";
import { DevToolsMetadataProvider } from "./providers/DevToolsMetadataProvider.ts";
import { DevToolsProvider } from "./providers/DevToolsProvider.ts";
import { LogRepository } from "./repositories/LogRepository.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/DevToolsMetadataProvider.ts";
export * from "./schemas/DevActionMetadata.ts";
export * from "./schemas/DevBucketMetadata.ts";
export * from "./schemas/DevCacheMetadata.ts";
export * from "./schemas/DevMetadata.ts";
export * from "./schemas/DevModuleMetadata.ts";
export * from "./schemas/DevPageMetadata.ts";
export * from "./schemas/DevProviderMetadata.ts";
export * from "./schemas/DevQueueMetadata.ts";
export * from "./schemas/DevRealmMetadata.ts";
export * from "./schemas/DevSchedulerMetadata.ts";
export * from "./schemas/DevTopicMetadata.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Developer tools module for monitoring and debugging Alepha applications.
 *
 * This module provides comprehensive data collection capabilities for tracking application behavior,
 * performance metrics, and debugging information in real-time.
 *
 * @see {@link DevToolsMetadataProvider}
 * @module alepha.devtools
 */
export const AlephaDevtools = $module({
  name: "alepha.devtools",
  descriptors: [],
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
    alepha.state.push("alepha.build.assets", "@alepha/devtools");
  },
});
