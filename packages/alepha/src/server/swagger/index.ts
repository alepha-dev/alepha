import "alepha/security";
import { $module } from "alepha";
import { AlephaServer, type RequestConfigSchema } from "alepha/server";
import { AlephaServerEtag } from "alepha/server/etag";
import { AlephaServerStatic } from "alepha/server/static";
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
 * - Routes: `GET /docs` (UI), `GET /docs/json` (spec) — prefix configurable via `$swagger({ prefix })`
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
    alepha.with(AlephaServerStatic);
    alepha.with(ServerSwaggerProvider);
    alepha.store.push("alepha.build.assets", "alepha");
  },
});
