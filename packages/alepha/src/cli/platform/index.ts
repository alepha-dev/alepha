import { $module } from "alepha";
import {
  AlephaCli,
  type AlephaCliConfig,
  registerConfigProcessor,
} from "alepha/cli";
import { CloudflareAdapter } from "./adapters/CloudflareAdapter.ts";
import { DockerAdapter } from "./adapters/DockerAdapter.ts";
import { VercelAdapter } from "./adapters/VercelAdapter.ts";
import {
  type PlatformOptions,
  platformOptions,
} from "./atoms/platformOptions.ts";
import { PlatformCommand } from "./commands/platform.ts";
import { SecretsCommand } from "./commands/SecretsCommand.ts";
import { GitHubSecretStore } from "./providers/GitHubSecretStore.ts";
import { MemorySecretStore } from "./providers/MemorySecretStore.ts";
import { PlatformCacheProvider } from "./providers/PlatformCacheProvider.ts";
import { CloudflareApi } from "./services/CloudflareApi.ts";
import { DockerComposeGenerator } from "./services/DockerComposeGenerator.ts";
import { DockerSshService } from "./services/DockerSshService.ts";
import { NamingService } from "./services/NamingService.ts";
import { PlatformInspector } from "./services/PlatformInspector.ts";
import { PlatformOrchestrator } from "./services/PlatformOrchestrator.ts";
import { SecretFilterService } from "./services/SecretFilterService.ts";
import { VercelApi } from "./services/VercelApi.ts";
import { VercelCli } from "./services/VercelCli.ts";
import { WranglerApi } from "./services/WranglerApi.ts";

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
    SecretsCommand,
    CloudflareAdapter,
    CloudflareApi,
    DockerAdapter,
    DockerComposeGenerator,
    DockerSshService,
    VercelAdapter,
    VercelApi,
    VercelCli,
    WranglerApi,
    PlatformCacheProvider,
    GitHubSecretStore,
    MemorySecretStore,
    NamingService,
    SecretFilterService,
    PlatformInspector,
    PlatformOrchestrator,
  ],
});

// ---------------------------------------------------------------------------

export * from "./adapters/CloudflareAdapter.ts";
export * from "./adapters/DockerAdapter.ts";
export * from "./adapters/PlatformAdapter.ts";
export * from "./adapters/VercelAdapter.ts";
export * from "./atoms/platformOptions.ts";
export * from "./commands/platform.ts";
export * from "./commands/SecretsCommand.ts";
export * from "./providers/GitHubSecretStore.ts";
export * from "./providers/MemorySecretStore.ts";
export * from "./providers/PlatformCacheProvider.ts";
export * from "./providers/SecretStoreProvider.ts";
export * from "./schemas/cloudflare.ts";
export * from "./schemas/platform.ts";
export * from "./schemas/vercel.ts";
export * from "./services/CloudflareApi.ts";
export * from "./services/DockerComposeGenerator.ts";
export * from "./services/DockerSshService.ts";
export * from "./services/NamingService.ts";
export * from "./services/PlatformInspector.ts";
export * from "./services/PlatformOrchestrator.ts";
export * from "./services/SecretFilterService.ts";
export * from "./services/VercelApi.ts";
export * from "./services/VercelCli.ts";
export * from "./services/WranglerApi.ts";
