import { AlephaUI } from "@alepha/ui";
import { $module } from "alepha";
import { AlephaReactAuth } from "alepha/react/auth";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AuthI18n } from "./AuthI18n.ts";
import { AuthRouter } from "./AuthRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./AuthRouter.ts";
export type { UserButtonProps } from "./components/buttons/UserButton.tsx";
export { default as UserButton } from "./components/buttons/UserButton.tsx";
export { default as Login } from "./components/Login.tsx";
export { default as Register } from "./components/Register.tsx";
export { default as ResetPassword } from "./components/ResetPassword.tsx";
export { default as VerifyEmail } from "./components/VerifyEmail.tsx";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | frontend | rare | experimental |
 *
 * Authentication UI components.
 *
 * **Features:**
 * - Login page component
 * - Register page component
 * - Reset password page component
 * - Email verification page component
 * - UserButton for user menu
 *
 * @module alepha.ui.auth
 */
export const AlephaUIAuth = $module({
  name: "alepha.ui.auth",
  services: [AlephaUI, AlephaReactAuth, AlephaReactI18n, AuthRouter, AuthI18n],
});
