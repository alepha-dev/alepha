import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { $cookie, type Cookies } from "./primitives/$cookie.ts";
import { ServerCookiesProvider } from "./providers/ServerCookiesProvider.ts";

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
 * Provides HTTP cookie management capabilities for server requests and responses with type-safe cookie primitives.
 *
 * The server-cookies module enables declarative cookie handling using the `$cookie` primitive on class properties.
 * It offers automatic cookie parsing, secure cookie configuration, and seamless integration with server routes
 * for managing user sessions, preferences, and authentication tokens.
 *
 * @see {@link $cookie}
 * @module alepha.server.cookies
 */
export const AlephaServerCookies = $module({
  name: "alepha.server.cookies",
  primitives: [$cookie],
  services: [AlephaServer, ServerCookiesProvider],
});
