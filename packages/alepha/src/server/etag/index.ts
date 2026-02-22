import { $module } from "alepha";
import { AlephaCache } from "alepha/cache";
import { AlephaCrypto } from "alepha/crypto";
import { ServerEtagProvider } from "./providers/ServerEtagProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$etag.ts";
export * from "./providers/ServerEtagProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * ETag-based response caching.
 *
 * **Features:**
 * - ETag generation and validation
 * - Conditional request handling (304 Not Modified)
 * - Optional response caching (store)
 * - Cache-Control header support
 *
 * @module alepha.server.etag
 */
export const AlephaServerEtag = $module({
  name: "alepha.server.etag",
  services: [AlephaCache, AlephaCrypto, ServerEtagProvider],
});
