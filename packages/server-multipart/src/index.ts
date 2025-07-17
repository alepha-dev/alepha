import { $module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { ServerMultipartProvider } from "./providers/ServerMultipartProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerMultipartProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * This module provides support for handling multipart/form-data requests.
 * It allows to parse body data containing t.file().
 *
 * @see {@link ServerMultipartProvider}
 * @module alepha.server.multipart
 */
export const AlephaServerMultipart = $module({
	name: "alepha.server.multipart",
	services: [AlephaServer, ServerMultipartProvider],
});
