import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { ServerCompressProvider } from "./providers/ServerCompressProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerCompressProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | backend | standard | stable |
 *
 * Response compression.
 *
 * **Features:**
 * - Gzip compression
 * - Brotli compression
 *
 * @module alepha.server.compress
 */
export const AlephaServerCompress = $module({
  name: "alepha.server.compress",
  services: [AlephaServer, ServerCompressProvider],
});
