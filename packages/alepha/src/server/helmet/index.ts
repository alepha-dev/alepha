import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { ServerHelmetProvider } from "./providers/ServerHelmetProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/ServerHelmetProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.15.0 | node, bun, workerd|
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
