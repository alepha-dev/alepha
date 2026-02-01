import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { ServerMultipartProvider } from "./providers/ServerMultipartProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerMultipartProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.5.0 | node, bun|
 *
 * Multipart form data handling for file uploads.
 *
 * **Features:**
 * - File upload parsing
 * - Form field extraction
 *
 * @module alepha.server.multipart
 */
export const AlephaServerMultipart = $module({
  name: "alepha.server.multipart",
  services: [AlephaServer, ServerMultipartProvider],
});
