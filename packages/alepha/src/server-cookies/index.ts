import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { $cookie, type Cookies } from "./descriptors/$cookie.ts";
import { ServerCookiesProvider } from "./providers/ServerCookiesProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$cookie.ts";
export * from "./providers/ServerCookiesProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha/server" {
  interface ServerRequest {
    cookies: Cookies;
  }
}

/**
 * Provides HTTP cookie management capabilities for server requests and responses with type-safe cookie descriptors.
 *
 * The server-cookies module enables declarative cookie handling using the `$cookie` descriptor on class properties.
 * It offers automatic cookie parsing, secure cookie configuration, and seamless integration with server routes
 * for managing user sessions, preferences, and authentication tokens.
 *
 * @see {@link $cookie}
 * @module alepha.server.cookies
 */
export const AlephaServerCookies = $module({
  name: "alepha.server.cookies",
  descriptors: [$cookie],
  services: [AlephaServer, ServerCookiesProvider],
});
