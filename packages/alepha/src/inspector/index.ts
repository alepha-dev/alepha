import { $module } from "alepha";

import { DevAtomLogProvider } from "./providers/DevAtomLogProvider.ts";
import { DevLogStoreProvider } from "./providers/DevLogStoreProvider.ts";
import { DevToolsMetadataProvider } from "./providers/DevToolsMetadataProvider.ts";
import { InspectorRoutes } from "./providers/InspectorRoutes.ts";
import { InspectorRunProvider } from "./providers/InspectorRunProvider.ts";
import { InspectorSocketServer } from "./providers/InspectorSocketServer.ts";
import { InspectorDispatcher } from "./services/InspectorDispatcher.ts";
import { InspectorRegistry } from "./services/InspectorRegistry.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";
export * from "./providers/DevAtomLogProvider.ts";
export * from "./providers/DevLogStoreProvider.ts";
export * from "./providers/DevToolsMetadataProvider.ts";
export * from "./providers/InspectorRoutes.ts";
export * from "./providers/InspectorRunProvider.ts";
export * from "./providers/InspectorSocketServer.ts";
export * from "./services/InspectorClient.ts";
export * from "./services/InspectorConnection.ts";
export * from "./services/InspectorDispatcher.ts";
export * from "./services/InspectorRegistry.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Runtime inspection of a running application, as a protocol other tools
 * build on.
 *
 * **Features:**
 * - Application metadata: actions, jobs, topics, storages, realms, roles,
 *   caches, pages, providers, modules, entities, env, atoms
 * - A log buffer that survives a restart, read with a cursor
 * - Database rows, job executions, atom writes, the local email and SMS outbox
 * - One route table, independent of `$route`, for every transport
 * - A run registry: each process announces itself in
 *   `~/.alepha/run/<runId>.json`, and `InspectorRegistry.discover()` lists them
 * - Served over a per-process Unix socket (`<runId>.sock`, `0600`), never on
 *   the app's own port
 *
 * No application imports it. `alepha dev` injects it into the app it serves,
 * and the devtools app (`npx @alepha/devtools`) is its first consumer.
 *
 * SECURITY: the inspector reads and MUTATES application state and serves the
 * environment, secrets included. It registers in development only: never in
 * production and never under test, unless `ALEPHA_INSPECT=1` asks for it
 * explicitly. The providers are deliberately NOT listed under `services`,
 * which would register them whatever this guard decides.
 *
 * @module alepha.inspector
 */
export const AlephaInspector = $module({
  name: "alepha.inspector",
  register: (alepha) => {
    // Says "this process carries the inspector", whether or not it turns on:
    // `run()` reads it to explain an `ALEPHA_INSPECT=1` given to a build
    // that has none.
    alepha.store.set("alepha.inspector.bundled" as any, true);

    const explicit = ["1", "true"].includes(
      String(alepha.env.ALEPHA_INSPECT ?? "").toLowerCase(),
    );

    // Production: a deployed app must never answer these routes by accident.
    // Test: every suite would otherwise run a log persister, and once the
    // registry lands, write entries and open sockets on the machine.
    if (!explicit && (alepha.isProduction() || alepha.isTest())) {
      return;
    }

    alepha.with(DevLogStoreProvider);
    alepha.with(DevAtomLogProvider);
    alepha.with(DevToolsMetadataProvider);
    alepha.with(InspectorRoutes);
    alepha.with(InspectorDispatcher);
    alepha.with(InspectorRegistry);
    alepha.with(InspectorRunProvider);
    alepha.with(InspectorSocketServer);
  },
});
