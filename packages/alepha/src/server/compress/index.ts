import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { ServerCompressProvider } from "./providers/ServerCompressProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$compress.ts";
export * from "./providers/ServerCompressProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.13.0 | node, bun|
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
