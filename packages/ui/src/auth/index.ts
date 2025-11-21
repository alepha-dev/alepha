import { $module } from "alepha";
import { AlephaUI } from "../core";
import { AuthRouter } from "./AuthRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./AuthRouter.ts";
export * from "./components/Login.tsx";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Login UI Module
 *
 * @module alepha.ui.auth
 */
export const AlephaUIAuth = $module({
  name: "alepha.ui.auth",
  services: [AlephaUI, AuthRouter],
});
