import "alepha/server/security";
import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { $client } from "./primitives/$client.ts";
import { $remote } from "./primitives/$remote.ts";
import { LinkProvider } from "./providers/LinkProvider.ts";
import { RemotePrimitiveProvider } from "./providers/RemotePrimitiveProvider.ts";
import { ServerLinksProvider } from "./providers/ServerLinksProvider.ts";
import type { ApiLinksResponse } from "./schemas/apiLinksResponseSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$client.ts";
export * from "./primitives/$remote.ts";
export * from "./providers/LinkProvider.ts";
export * from "./providers/RemotePrimitiveProvider.ts";
export * from "./providers/ServerLinksProvider.ts";
export * from "./schemas/apiLinksResponseSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface State {
    /**
     * API links attached to the server request state.
     *
     * @see {@link ApiLinksResponse}
     * @internal
     */
    "alepha.server.request.apiLinks"?: ApiLinksResponse;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides server-side link management and remote capabilities for client-server interactions.
 *
 * The server-links module enables declarative link definitions using `$remote` and `$client` primitives,
 * facilitating seamless API endpoint management and client-server communication. It integrates with server
 * security features to ensure safe and controlled access to resources.
 *
 * @see {@link $remote}
 * @see {@link $client}
 * @module alepha.server.links
 */
export const AlephaServerLinks = $module({
  name: "alepha.server.links",
  primitives: [$remote, $client],
  services: [
    AlephaServer,
    ServerLinksProvider,
    RemotePrimitiveProvider,
    LinkProvider,
  ],
});
