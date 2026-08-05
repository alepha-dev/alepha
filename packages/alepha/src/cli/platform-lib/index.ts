import { $module } from "alepha";
import { BayAdapter } from "./adapters/BayAdapter.ts";
import { CloudflareAdapter } from "./adapters/CloudflareAdapter.ts";
import { GitHubSecretStore } from "./providers/GitHubSecretStore.ts";
import { MemorySecretStore } from "./providers/MemorySecretStore.ts";
import { PlatformCacheProvider } from "./providers/PlatformCacheProvider.ts";
import { CloudflareApi } from "./services/CloudflareApi.ts";
import { NamingService } from "./services/NamingService.ts";
import { PlatformInspector } from "./services/PlatformInspector.ts";
import { PlatformOrchestrator } from "./services/PlatformOrchestrator.ts";
import { SecretFilterService } from "./services/SecretFilterService.ts";
import { WranglerApi } from "./services/WranglerApi.ts";

/**
 * Framework-agnostic platform deploy services.
 *
 * Exports `PlatformOrchestrator` + adapters + secret stores + the
 * `platformOptions` atom — everything needed to drive a deploy
 * programmatically. **No `$command` instances** and **no
 * `AppEntryProvider` / `ViteBuildProvider` dependency** — so consumers
 * importing this subpath don't pull in the CLI argv-parser or Vite.
 *
 * Used by Alepha Rocket (and other non-CLI deploy orchestrators) to
 * call `orchestrator.up({ ... })` directly. For CLI usage
 * (`alepha platform up`), import `AlephaCliPlatformPlugin` from
 * `alepha/cli/platform` — that one adds the command layer on top.
 */
export const AlephaPlatformLibPlugin = $module({
  name: "alepha.cli.platform-lib",
  services: [
    BayAdapter,
    CloudflareAdapter,
    CloudflareApi,
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

export * from "./adapters/BayAdapter.ts";
export * from "./adapters/CloudflareAdapter.ts";
export * from "./adapters/PlatformAdapter.ts";
export * from "./atoms/platformOptions.ts";
export * from "./providers/GitHubSecretStore.ts";
export * from "./providers/MemorySecretStore.ts";
export * from "./providers/PlatformCacheProvider.ts";
export * from "./providers/SecretStoreProvider.ts";
export * from "./schemas/cloudflare.ts";
export * from "./schemas/platform.ts";
export * from "./services/CloudflareApi.ts";
export * from "./services/NamingService.ts";
export * from "./services/PlatformInspector.ts";
export * from "./services/PlatformOrchestrator.ts";
export * from "./services/SecretFilterService.ts";
export * from "./services/WranglerApi.ts";
