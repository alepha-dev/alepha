import "alepha/server/security";
import { $module } from "alepha";
import { AlephaServer, type RequestConfigSchema } from "alepha/server";
import { AlephaServerCache } from "alepha/server/cache";
import { AlephaServerStatic } from "alepha/server/static";
import { $swagger } from "./descriptors/$swagger.ts";
import { ServerSwaggerProvider } from "./ServerSwaggerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$swagger.ts";
export * from "./ServerSwaggerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha/server" {
  interface ActionDescriptorOptions<TConfig extends RequestConfigSchema> {
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
 * Plugin for Alepha Server that provides Swagger documentation capabilities.
 * It generates OpenAPI v3 documentation for the server's endpoints ($action).
 * It also provides a Swagger UI for interactive API documentation.
 *
 * @see {@link ServerSwaggerProvider}
 * @module alepha.server.swagger
 */
export const AlephaServerSwagger = $module({
  name: "alepha.server.swagger",
  descriptors: [$swagger],
  services: [ServerSwaggerProvider],
  register: (alepha) => {
    alepha.with(AlephaServer);
    alepha.with(AlephaServerCache);
    alepha.with(AlephaServerStatic);
    alepha.with(ServerSwaggerProvider);
    alepha.state.push("alepha.build.assets", "alepha/server/swagger");
  },
});
