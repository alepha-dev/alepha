import { $module } from "alepha";

import { BayAdapter } from "./adapters/BayAdapter.ts";
import { CloudflareAdapter } from "./adapters/CloudflareAdapter.ts";
import type { EnvironmentDescriptor } from "./adapters/PlatformAdapter.ts";
import { GitHubSecretStore } from "./providers/GitHubSecretStore.ts";
import { MemorySecretStore } from "./providers/MemorySecretStore.ts";
import { PlatformCacheProvider } from "./providers/PlatformCacheProvider.ts";
import type { BayEnvironmentOptions } from "./schemas/bayEnvironmentOptions.ts";
import type { CloudflareEnvironmentOptions } from "./schemas/cloudflareEnvironmentOptions.ts";
import { CloudflareApi } from "./services/CloudflareApi.ts";
import { D1MigrationsService } from "./services/D1MigrationsService.ts";
import { NamingService } from "./services/NamingService.ts";
import { PlatformInspector } from "./services/PlatformInspector.ts";
import { PlatformOrchestrator } from "./services/PlatformOrchestrator.ts";
import { SecretFilterService } from "./services/SecretFilterService.ts";
import { WranglerApi } from "./services/WranglerApi.ts";

/**
 * Framework-agnostic platform deploy services.
 *
 * Exports `PlatformOrchestrator` + adapters + secret stores + the
 * `platformOptions` atom: everything needed to drive a deploy
 * programmatically. **No `$command` instances** and **no
 * `AppEntryProvider` / `ViteBuildProvider` dependency**, so consumers
 * importing this subpath don't pull in the CLI argv-parser or Vite.
 *
 * Used by Alepha Rocket (and other non-CLI deploy orchestrators) to
 * call `orchestrator.up({ ... })` directly. For CLI usage
 * (`alepha platform up`), import `AlephaCliPlatformPlugin` from
 * `alepha/cli/platform`, which adds the command layer on top.
 *
 * @module alepha.cli.platform-lib
 */
export const AlephaPlatformLibPlugin = $module({
  name: "alepha.cli.platform-lib",
  services: [
    BayAdapter,
    CloudflareAdapter,
    CloudflareApi,
    D1MigrationsService,
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

/**
 * An environment that deploys to Cloudflare Workers, through wrangler and the
 * Cloudflare API.
 *
 * ```ts
 * platform({
 *   environments: {
 *     production: cloudflare({ domain: "myapp.com", jurisdiction: "eu" }),
 *     preview: cloudflare(), // the workers.dev subdomain
 *   },
 * });
 * ```
 *
 * Node only: the adapter shells out, so the `workerd` entry exports no factory.
 */
export const cloudflare = (
  options: CloudflareEnvironmentOptions = {},
): EnvironmentDescriptor<CloudflareEnvironmentOptions> => ({
  adapter: CloudflareAdapter,
  options,
});

/**
 * An environment that deploys to Alepha Bay, a machine you own, over ssh.
 *
 * ```ts
 * platform({
 *   environments: {
 *     production: bay({ host: "deploy@bay.example.com", domain: "myapp.com" }),
 *   },
 * });
 * ```
 *
 * `host` is required here or through `$BAY_HOST`. Node only, like
 * {@link cloudflare}.
 */
export const bay = (
  options: BayEnvironmentOptions = {},
): EnvironmentDescriptor<BayEnvironmentOptions> => ({
  adapter: BayAdapter,
  options,
});

export * from "./adapters/BayAdapter.ts";
export * from "./adapters/CloudflareAdapter.ts";
export * from "./adapters/PlatformAdapter.ts";
// ⚠️ Exported here as well as from the `workerd` entry, but no factory names
// it: under node `cloudflare()` is the wrangler-driven adapter. A consumer that
// means to run this one - Lore's `DeployRunner` - writes its descriptor itself.
export * from "./adapters/WorkerCloudflareAdapter.ts";
export * from "./atoms/platformOptions.ts";
export * from "./schemas/bayEnvironmentOptions.ts";
export * from "./schemas/cloudflareEnvironmentOptions.ts";
export * from "./schemas/environmentOptions.ts";
export * from "./providers/GitHubSecretStore.ts";
export * from "./providers/MemorySecretStore.ts";
export * from "./providers/PlatformCacheProvider.ts";
export * from "./providers/SecretStoreProvider.ts";
export * from "./schemas/cloudflare.ts";
export * from "./schemas/platform.ts";
export * from "./secretKeys.ts";
export * from "./services/CloudflareApi.ts";
export * from "./services/CloudflareAssetManifest.ts";
export * from "./services/CloudflareProvisionClient.ts";
export * from "./services/CloudflareDeployClient.ts";
export * from "./services/D1MigrationsService.ts";
export * from "./services/NamingService.ts";
export * from "./services/PlatformInspector.ts";
export * from "./services/PlatformOrchestrator.ts";
export * from "./services/SecretFilterService.ts";
export * from "./services/WranglerApi.ts";
