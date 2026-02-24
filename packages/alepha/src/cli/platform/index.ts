import { $module } from "alepha";
import {
  AlephaCli,
  type AlephaCliConfig,
  registerConfigProcessor,
} from "alepha/cli";
import { CloudflareAdapter } from "./adapters/CloudflareAdapter.ts";
import {
  type PlatformOptions,
  platformOptions,
} from "./atoms/platformOptions.ts";
import { PlatformCommand } from "./commands/platform.ts";
import { PlatformCacheProvider } from "./providers/PlatformCacheProvider.ts";
import { NamingService } from "./services/NamingService.ts";
import { PlatformInspector } from "./services/PlatformInspector.ts";
import { PlatformOrchestrator } from "./services/PlatformOrchestrator.ts";

// ---------------------------------------------------------------------------
// Module augmentation — extends AlephaCliConfig with platform options
// ---------------------------------------------------------------------------

declare module "alepha/cli" {
  interface AlephaCliConfig {
    /**
     * Platform deployment configuration.
     */
    platform?: PlatformOptions;
  }
}

registerConfigProcessor((alepha: any, config: AlephaCliConfig) => {
  if (config.platform) {
    alepha.set(platformOptions, config.platform);
  }
});

// ---------------------------------------------------------------------------

export const AlephaCliPlatform = $module({
  name: "alepha.cli.platform",
  services: [
    AlephaCli,
    PlatformCommand,
    CloudflareAdapter,
    PlatformCacheProvider,
    NamingService,
    PlatformInspector,
    PlatformOrchestrator,
  ],
});

// ---------------------------------------------------------------------------

export * from "./adapters/CloudflareAdapter.ts";
export * from "./adapters/PlatformAdapter.ts";
export * from "./atoms/platformOptions.ts";
export * from "./commands/platform.ts";
export * from "./providers/PlatformCacheProvider.ts";
export * from "./services/NamingService.ts";
export * from "./services/PlatformInspector.ts";
export * from "./services/PlatformOrchestrator.ts";
