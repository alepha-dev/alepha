import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { AlephaServerStatic } from "alepha/server/static";
import { DevToolsMetadataProvider } from "./providers/DevToolsMetadataProvider.ts";
import { DevToolsProvider } from "./providers/DevToolsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";
export * from "./providers/DevToolsMetadataProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Runtime inspection and debugging UI.
 *
 * **Features:**
 * - DevTools UI at `GET /__devtools`
 * - Application metadata at `GET /__devtools/api/metadata`
 * - Last 10,000 logs at `GET /__devtools/api/logs`
 * - Runtime inspection of actions, jobs, topics, storages
 * - Log viewer with filtering
 * - React Flow visualization
 * - Provider and module browsing
 *
 * @module alepha.devtools
 */
export const AlephaDevtools = $module({
  name: "alepha.devtools",
  primitives: [],
  register: (alepha) => {
    // SECURITY: DevTools mounts unauthenticated endpoints that read and MUTATE
    // application state — arbitrary DB create/update/delete, atom writes, and
    // cleartext env (secrets) via `/devtools/metadata`. It must NEVER be exposed
    // on a deployed app. Guard registration here (like sigil does) so that
    // importing this module into a production server graph — as the module docs
    // suggest — cannot accidentally expose those routes. The route-bearing
    // providers are intentionally NOT listed under `services` (which would
    // auto-inject them regardless of this guard); they are registered only in
    // non-production, so their `$route` fields never mount in prod.
    if (alepha.isProduction()) {
      return;
    }
    alepha.with(AlephaServer);
    alepha.with(AlephaServerStatic);
    alepha.with(DevToolsProvider);
    alepha.with(DevToolsMetadataProvider);
    alepha.store.push("alepha.build.assets", "alepha");
  },
});
