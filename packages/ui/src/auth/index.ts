import { AlephaReactI18n } from "@alepha/react/i18n";
import { $module } from "alepha";
import { AlephaUI } from "../core";
import { AuthI18n } from "./AuthI18n.ts";
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
  services: [AlephaUI, AlephaReactI18n, AuthRouter, AuthI18n],
});
