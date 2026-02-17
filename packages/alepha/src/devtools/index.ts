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
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 2 - experimental | 0.10.0 | node, bun |
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
  services: [DevToolsMetadataProvider, DevToolsProvider],
  register: (alepha) => {
    alepha.with(AlephaServer);
    alepha.with(AlephaServerStatic);
    alepha.with(DevToolsProvider);
    alepha.with(DevToolsMetadataProvider);
    alepha.store.push("alepha.build.assets", "alepha");
  },
});
