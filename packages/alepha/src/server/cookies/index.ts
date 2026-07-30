import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { $cookie, type Cookies } from "./primitives/$cookie.ts";
import { AtomCookiePersistence } from "./providers/AtomCookiePersistence.ts";
import { ServerCookiesProvider } from "./providers/ServerCookiesProvider.ts";
import { CookieParser } from "./services/CookieParser.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$cookie.ts";
export * from "./providers/AtomCookiePersistence.ts";
export * from "./providers/ServerCookiesProvider.ts";
export * from "./services/CookieParser.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha/server" {
  interface ServerRequest {
    cookies: Cookies;
  }
}

/**
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
  services: [
    AlephaServer,
    ServerCookiesProvider,
    CookieParser,
    AtomCookiePersistence,
  ],
});
