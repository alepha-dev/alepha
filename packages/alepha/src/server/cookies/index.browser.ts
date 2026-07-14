import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { AtomCookiePersistence } from "./providers/AtomCookiePersistence.browser.ts";
import { CookieParser } from "./services/CookieParser.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$cookie.browser.ts";
export * from "./providers/AtomCookiePersistence.browser.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaServerCookies = $module({
  name: "alepha.server.cookies",
  primitives: [],
  services: [AlephaServer, CookieParser, AtomCookiePersistence],
});
