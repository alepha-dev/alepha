import { $module } from "alepha";
import { AlephaUI } from "../core";

/**
 * Login UI Module
 *
 * @module alepha.ui.auth
 */
export const AlephaUIAuth = $module({
  name: "alepha.ui.auth",
  services: [AlephaUI],
});
