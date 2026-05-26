import { $module } from "alepha";
import { CloudflareAdapter } from "./adapters/CloudflareAdapter.ts";
import { VercelAdapter } from "./adapters/VercelAdapter.ts";
import { GitHubSecretStore } from "./providers/GitHubSecretStore.ts";
import { MemorySecretStore } from "./providers/MemorySecretStore.ts";
import { PlatformCacheProvider } from "./providers/PlatformCacheProvider.ts";
import { CloudflareApi } from "./services/CloudflareApi.ts";
import { NamingService } from "./services/NamingService.ts";
import { PlatformInspector } from "./services/PlatformInspector.ts";
import { PlatformOrchestrator } from "./services/PlatformOrchestrator.ts";
import { SecretFilterService } from "./services/SecretFilterService.ts";
import { VercelApi } from "./services/VercelApi.ts";
import { VercelCli } from "./services/VercelCli.ts";
import { WranglerApi } from "./services/WranglerApi.ts";

/**
 * Framework-agnostic platform orchestration module.
 *
 * Programmatic access to `PlatformOrchestrator` + adapters + hooks, without
 * the CLI commands. Use this when embedding deploy operations in a service
 * (Alepha Rocket, custom orchestration tooling, etc.).
 *
 * For CLI usage (`alepha platform up`), import `AlephaCliPlatformPlugin`
 * from `alepha/cli/platform` instead — it pulls in this module and adds
 * the command layer.
 */
export const AlephaPlatformPlugin = $module({
  name: "alepha.platform",
  services: [
    CloudflareAdapter,
    CloudflareApi,
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

export * from "./adapters/CloudflareAdapter.ts";
export * from "./adapters/PlatformAdapter.ts";
export * from "./adapters/VercelAdapter.ts";
export * from "./atoms/platformOptions.ts";
export * from "./hooks/PlatformHook.ts";
export * from "./providers/GitHubSecretStore.ts";
export * from "./providers/MemorySecretStore.ts";
export * from "./providers/PlatformCacheProvider.ts";
export * from "./providers/SecretStoreProvider.ts";
export * from "./schemas/cloudflare.ts";
export * from "./schemas/platform.ts";
export * from "./schemas/vercel.ts";
export * from "./services/CloudflareApi.ts";
export * from "./services/NamingService.ts";
export * from "./services/PlatformInspector.ts";
export * from "./services/PlatformOrchestrator.ts";
export * from "./services/SecretFilterService.ts";
export * from "./services/VercelApi.ts";
export * from "./services/VercelCli.ts";
export * from "./services/WranglerApi.ts";
