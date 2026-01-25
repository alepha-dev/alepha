import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { ServerMultipartProvider } from "./providers/ServerMultipartProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerMultipartProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | backend | standard | stable |
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
