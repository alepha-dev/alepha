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
 *   and `node:fs/promises` today. Replacing that path with the `cloudflare`
 *   SDK is #1517; when it lands, its adapter is registered here.
 * - `GitHubSecretStore` and `PlatformCacheProvider` read the disk.
 *
 * So the registry starts EMPTY under workerd, and `resolveAdapter` says so in
 * as many words rather than reading as a typo in the config. That is the
 * honest state: this entry is the seam, and #1517 is what fills it.
 *
 * @module alepha.cli.platform-lib
 */
import { $module } from "alepha";

import { MemorySecretStore } from "./providers/MemorySecretStore.ts";
import { NamingService } from "./services/NamingService.ts";
import { PlatformAdapterRegistry } from "./services/PlatformAdapterRegistry.ts";
import { PlatformInspector } from "./services/PlatformInspector.ts";
import { PlatformOrchestrator } from "./services/PlatformOrchestrator.ts";
import { SecretFilterService } from "./services/SecretFilterService.ts";

export * from "./adapters/PlatformAdapter.ts";
export * from "./atoms/platformOptions.ts";
export * from "./providers/MemorySecretStore.ts";
export * from "./providers/SecretStoreProvider.ts";
export * from "./schemas/cloudflare.ts";
export * from "./schemas/platform.ts";
export * from "./services/NamingService.ts";
export * from "./services/PlatformAdapterRegistry.ts";
export * from "./services/PlatformInspector.ts";
export * from "./services/PlatformOrchestrator.ts";
export * from "./services/SecretFilterService.ts";

export const AlephaPlatformLibPlugin = $module({
  name: "alepha.cli.platform-lib",
  services: [
    PlatformAdapterRegistry,
    MemorySecretStore,
    NamingService,
    SecretFilterService,
    PlatformInspector,
    PlatformOrchestrator,
  ],
});
