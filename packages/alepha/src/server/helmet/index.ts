import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { ServerHelmetProvider } from "./providers/ServerHelmetProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerHelmetProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | backend | standard | stable |
 *
 * HTTP security headers.
 *
 * **Features:**
 * - X-Frame-Options
 * - X-Content-Type-Options
 * - Content-Security-Policy
 * - Other security headers
 *
 * @module alepha.server.helmet
 */
export const AlephaServerHelmet = $module({
  name: "alepha.server.helmet",
  services: [AlephaServer, ServerHelmetProvider],
});
