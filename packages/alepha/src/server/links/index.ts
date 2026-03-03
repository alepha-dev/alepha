import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
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
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

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
 * @module alepha.server.links
 */
export const AlephaServerLinks = $module({
  name: "alepha.server.links",
  atoms: [apiLinksAtom, linkOptionsAtom],
  primitives: [$remote, $client],
  services: [
    AlephaServer,
    ServerLinksProvider,
    RemotePrimitiveProvider,
    LinkProvider,
    BatchCollector,
  ],
});
