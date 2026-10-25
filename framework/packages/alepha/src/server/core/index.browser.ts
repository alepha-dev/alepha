import { $module } from "alepha";

import { HttpClient } from "./services/HttpClient.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Mirrors the node barrel's `alepha.http` so `AlephaHttpClient` resolves under
 * every export condition. A split-condition barrel is unguarded: an export
 * present in one and missing from the other typechecks and tests green, and
 * only the browser or workerd build finds it.
 *
 * @module alepha.http
 */
export const AlephaHttpClient = $module({
  name: "alepha.http",
  services: [HttpClient],
});

/**
 * In the browser there is nothing to serve, so this has only ever been the
 * outbound client - which is exactly what the node barrel now separates out.
 */
export const AlephaServer = $module({
  name: "alepha.server",
  primitives: [],
  imports: [AlephaHttpClient],
});
