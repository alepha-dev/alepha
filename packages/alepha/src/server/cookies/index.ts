import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { $cookie, type Cookies } from "./primitives/$cookie.ts";
import { ServerCookiesProvider } from "./providers/ServerCookiesProvider.ts";
import { CookieParser } from "./services/CookieParser.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$cookie.ts";
export * from "./providers/ServerCookiesProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha/server" {
  interface ServerRequest {
    cookies: Cookies;
  }
}

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.3.0 | node, bun, workerd|
 *
 * Server and browser-safe cookie handling.
 *
 * **Features:**
 * - Cookie management on server and browser
 *
 * @module alepha.server.cookies
 */
export const AlephaServerCookies = $module({
  name: "alepha.server.cookies",
  primitives: [$cookie],
  services: [AlephaServer, ServerCookiesProvider, CookieParser],
});
