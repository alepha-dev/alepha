/**
 * What `alepha/cli/platform-lib` is under the `workerd` export condition: the
 * orchestration, the naming and the config resolution, with no adapter that
 * shells out.
 *
 * ⚠️ **Deliberately a fraction of the Node entry.** Same reasoning as
 * `alepha/cli`'s own workerd entry: a name omitted here fails at BUILD time in
 * CI, which is where importing `WranglerApi` into a Worker should fail. The
 * three things this file cannot carry, and why:
 *
 * - `BayAdapter` and `WranglerApi` shell out (`node:child_process` through
 *   `ShellProvider`). A Bay deploy is a websocket command from Lore, not a
 *   local process, and `alepha platform up` on a laptop keeps both.
 * - `CloudflareAdapter` and `CloudflareApi` reach `WranglerApi`, `node:crypto`
 *   and `node:fs/promises`. {@link WorkerCloudflareAdapter} is what replaces
 *   them here, composing #1517's deploy client, #288's provisioning client and
 *   the migration service.
 * - `GitHubSecretStore` and `PlatformCacheProvider` read the disk.
 *
 * So `cloudflare` resolves to the worker-side adapter and `bay` resolves to
 * nothing: a Bay deploy is a websocket command from Lore rather than anything
 * this container drives.
 *
 * @module alepha.cli.platform-lib
 */
import { $module } from "alepha";

import { WorkerCloudflareAdapter } from "./adapters/WorkerCloudflareAdapter.ts";
import { MemorySecretStore } from "./providers/MemorySecretStore.ts";
import { D1MigrationsService } from "./services/D1MigrationsService.ts";
import { NamingService } from "./services/NamingService.ts";
import { PlatformAdapterRegistry } from "./services/PlatformAdapterRegistry.ts";
import { PlatformInspector } from "./services/PlatformInspector.ts";
import { PlatformOrchestrator } from "./services/PlatformOrchestrator.ts";
import { SecretFilterService } from "./services/SecretFilterService.ts";

export * from "./adapters/PlatformAdapter.ts";
export * from "./adapters/WorkerCloudflareAdapter.ts";
export * from "./atoms/platformOptions.ts";
export * from "./providers/MemorySecretStore.ts";
export * from "./providers/SecretStoreProvider.ts";
export * from "./schemas/cloudflare.ts";
export * from "./schemas/platform.ts";
export * from "./services/CloudflareAssetManifest.ts";
export * from "./services/CloudflareProvisionClient.ts";
export * from "./services/CloudflareDeployClient.ts";
export * from "./services/D1MigrationsService.ts";
export * from "./services/NamingService.ts";
export * from "./services/PlatformAdapterRegistry.ts";
export * from "./services/PlatformInspector.ts";
export * from "./services/PlatformOrchestrator.ts";
export * from "./services/SecretFilterService.ts";

export const AlephaPlatformLibPlugin = $module({
  name: "alepha.cli.platform-lib",
  register: (alepha) =>
    alepha
      .inject(PlatformAdapterRegistry)
      .set("cloudflare", WorkerCloudflareAdapter),
  services: [
    PlatformAdapterRegistry,
    WorkerCloudflareAdapter,
    D1MigrationsService,
    MemorySecretStore,
    NamingService,
    SecretFilterService,
    PlatformInspector,
    PlatformOrchestrator,
  ],
});
