import { AlephaReactAuth } from "@alepha/react/auth";
import { AlephaReactI18n } from "@alepha/react/i18n";
import { $module } from "alepha";
import { AlephaUI } from "../core";
import { AuthI18n } from "./AuthI18n.ts";
import { AuthRouter } from "./AuthRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./AuthRouter.ts";
export type { UserButtonProps } from "./components/buttons/UserButton.tsx";
export { default as UserButton } from "./components/buttons/UserButton.tsx";
export { default as Login } from "./components/Login.tsx";
export { default as Register } from "./components/Register.tsx";
export { default as ResetPassword } from "./components/ResetPassword.tsx";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Login UI Module
 *
 * @module alepha.ui.auth
 */
export const AlephaUIAuth = $module({
  name: "alepha.ui.auth",
  services: [AlephaUI, AlephaReactAuth, AlephaReactI18n, AuthRouter, AuthI18n],
});
