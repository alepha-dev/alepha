import { $module } from "alepha";
import { AlephaHttpClient, AlephaServer } from "alepha/server";

import { apiLinksAtom } from "./atoms/apiLinksAtom.ts";
import { linkOptionsAtom } from "./atoms/linkOptionsAtom.ts";
import { $client } from "./primitives/$client.ts";
import { $remote } from "./primitives/$remote.ts";
import { LinkProvider } from "./providers/LinkProvider.ts";
import { RemotePrimitiveProvider } from "./providers/RemotePrimitiveProvider.ts";
import { ServerLinksProvider } from "./providers/ServerLinksProvider.ts";
import type { ApiRegistryResponse } from "./schemas/apiLinksResponseSchema.ts";
import { BatchCollector } from "./services/BatchCollector.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./atoms/apiLinksAtom.ts";
export * from "./atoms/linkOptionsAtom.ts";
export * from "./primitives/$client.ts";
export * from "./primitives/$remote.ts";
export * from "./providers/LinkProvider.ts";
export * from "./providers/RemotePrimitiveProvider.ts";
export * from "./providers/ServerLinksProvider.ts";
export * from "./schemas/apiLinksResponseSchema.ts";
export * from "./services/BatchCollector.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface State {
    /**
     * API registry attached to the server request state.
     *
     * @see {@link ApiRegistryResponse}
     * @internal
     */
    "alepha.server.request.apiLinks"?: ApiRegistryResponse;

    /**
     * Configuration options for the links module.
     */
    "alepha.server.links.options": {
      batch: boolean;
      remoteRegistryTtl: number;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The half that CALLS an Alepha API, and never serves one.
 *
 * Register this rather than {@link AlephaServerLinks} from a process that is
 * not a server - a CLI, a script, a worker - so nothing declares a route or
 * binds a port. `$client()` is the whole surface.
 *
 * Deliberately untagged: `gen-docs` takes the first JSDoc block in the file
 * carrying a module tag as the package page's Overview, and that page is about
 * `alepha/server/links` as a whole rather than about its consumer half.
 */
export const AlephaServerLinksClient = $module({
  name: "alepha.server.links.client",
  atoms: [apiLinksAtom, linkOptionsAtom],
  primitives: [$client],
  imports: [AlephaHttpClient],
  services: [LinkProvider, BatchCollector],
});

/**
 * Type-safe API client with request deduplication.
 *
 * **Features:**
 * - Virtual HTTP client for type-safe API calls
 * - Remote action definitions
 * - Type inference from action schemas
 * - Request deduplication
 * - Automatic error handling
 *
 * Serving and calling, composed: the consumer half is
 * {@link AlephaServerLinksClient}, and what this adds on top is the part that
 * needs an HTTP server - the `/api/_links`, `/api/_links/schemas` and
 * `/api/_batch` routes, plus `$remote`'s service-to-service wiring.
 *
 * The split is stated here rather than detected at runtime. `register()` can
 * only see what was registered before it, so an `alepha.has(AlephaServer)`
 * test would silently drop the routes for any app that registers this module
 * first - and for a client-rendered app, `/api/_batch` missing is the whole
 * API surface missing.
 *
 * @module alepha.server.links
 */
export const AlephaServerLinks = $module({
  name: "alepha.server.links",
  imports: [AlephaServerLinksClient],
  primitives: [$remote],
  services: [AlephaServer, ServerLinksProvider, RemotePrimitiveProvider],
});
