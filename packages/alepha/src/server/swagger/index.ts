import "alepha/security";
import { $module } from "alepha";
import { AlephaServer, type RequestConfigSchema } from "alepha/server";
import { AlephaServerCache } from "alepha/server/cache";
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
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.9.0 | node, bun|
 *
 * Automatic API documentation generation.
 *
 * **Features:**
 * - Swagger/OpenAPI configuration
 * - Routes: `GET /swagger/ui`, `GET /swagger.json`
 *
 * @module alepha.server.swagger
 */
export const AlephaServerSwagger = $module({
  name: "alepha.server.swagger",
  primitives: [$swagger],
  services: [ServerSwaggerProvider],
  register: (alepha) => {
    alepha.with(AlephaServer);
    alepha.with(AlephaServerCache);
    alepha.with(AlephaServerStatic);
    alepha.with(ServerSwaggerProvider);
    alepha.store.push("alepha.build.assets", "alepha");
  },
});
