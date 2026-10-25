/**
 * Sign-in, registration and recovery screens.
 *
 * `AuthRouter` mounts the whole flow; `AuthLogin`, `AuthRegister`,
 * `AuthResetPassword`, `AuthVerifyEmail` and `AuthMfaStep` are its pages, for an
 * app that lays them out itself. `TurnstileWidget` is the captcha they share.
 *
 * @module alepha.ui.auth
 */

export { AuthLogin, type AuthLoginProps } from "./AuthLogin.tsx";
export { AuthMfaStep, type AuthMfaStepProps } from "./AuthMfaStep.tsx";
export { AuthRegister, type AuthRegisterProps } from "./AuthRegister.tsx";
export {
  AuthResetPassword,
  type AuthResetPasswordProps,
} from "./AuthResetPassword.tsx";
export { AuthRouter } from "./AuthRouter.tsx";
export {
  AuthVerifyEmail,
  type AuthVerifyEmailProps,
  type VerifyEmailStep,
} from "./AuthVerifyEmail.tsx";
export {
  TurnstileWidget,
  type TurnstileWidgetHandle,
  type TurnstileWidgetProps,
} from "./TurnstileWidget.tsx";
