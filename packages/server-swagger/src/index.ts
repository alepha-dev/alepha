import { $module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { $swagger } from "./descriptors/$swagger.ts";
import { ServerSwaggerProvider } from "./ServerSwaggerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$swagger.ts";
export * from "./ServerSwaggerProvider.ts";

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
	services: [AlephaServer, ServerSwaggerProvider],
});
