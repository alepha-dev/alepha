// Registers `alepha/security` so the swagger module can describe the auth
// schemes it declares; there is nothing to bind.
// oxlint-disable-next-line import/no-unassigned-import
import "alepha/security";
import { $module } from "alepha";
import { AlephaServer, type RequestConfigSchema } from "alepha/server";
import { AlephaServerEtag } from "alepha/server/etag";

import { $swagger } from "./primitives/$swagger.ts";
import { ServerSwaggerProvider } from "./providers/ServerSwaggerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$swagger.ts";
export * from "./providers/ServerSwaggerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha/server" {
  interface ActionPrimitiveOptions<TConfig extends RequestConfigSchema> {
    /**
     * Short description of the route.
     */
    summary?: string;

    /**
     * Don't include this action in the Swagger documentation.
     */
    hide?: boolean;

    /**
     * Mark this action as deprecated in the documentation.
     */
    deprecated?: boolean;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Automatic API documentation generation.
 *
 * **Features:**
 * - Swagger/OpenAPI configuration
 * - Route: `GET /docs/json` (the OpenAPI document) - prefix configurable via `$swagger({ prefix })`
 * - No viewer: point any OpenAPI viewer at the JSON route
 *
 * @module alepha.server.swagger
 */
export const AlephaServerSwagger = $module({
  name: "alepha.server.swagger",
  primitives: [$swagger],
  services: [ServerSwaggerProvider],
  register: (alepha) => {
    alepha.with(AlephaServer);
    alepha.with(AlephaServerEtag);
    alepha.with(ServerSwaggerProvider);
  },
});
