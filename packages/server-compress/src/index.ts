import { $module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { ServerCompressProvider } from "./providers/ServerCompressProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerCompressProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for Alepha Server that provides server-side compression capabilities.
 *
 * Compresses responses using gzip, brotli, or zstd based on the `Accept-Encoding` header.
 */
export const AlephaServerCompress = $module({
	name: "alepha.server.compress",
	services: [AlephaServer, ServerCompressProvider],
});
