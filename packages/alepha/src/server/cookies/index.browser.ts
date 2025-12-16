import { $module } from "alepha";
import { AlephaServer } from "alepha/server";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$cookie.browser.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaServerCookies = $module({
  name: "alepha.server.cookies",
  primitives: [],
  services: [AlephaServer],
});
