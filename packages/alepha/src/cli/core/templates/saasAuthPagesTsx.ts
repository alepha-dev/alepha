/**
 * Per-page wrapper around the registry components. The registry component
 * receives the realm config from the page loader; the page itself stays a
 * thin shell so apps can layer their branding around it.
 *
 * Registry components land at `src/components/auth/*` (shadcn defaults).
 */

export const saasAuthLoginTsx = () =>
  `import { AuthLogin } from "@/components/auth/auth-login";
import type { RealmConfig } from "alepha/api/users";

export interface AuthLoginPageProps {
  realmConfig: RealmConfig;
}

const AuthLoginPage = (props: AuthLoginPageProps) => {
  return <AuthLogin realmConfig={props.realmConfig} />;
};

export default AuthLoginPage;
`;

export const saasAuthRegisterTsx = () =>
  `import { AuthRegister } from "@/components/auth/auth-register";
import type { RealmConfig } from "alepha/api/users";

export interface AuthRegisterPageProps {
  realmConfig: RealmConfig;
}

const AuthRegisterPage = (props: AuthRegisterPageProps) => {
  return <AuthRegister realmConfig={props.realmConfig} />;
};

export default AuthRegisterPage;
`;

export const saasAuthResetPasswordTsx = () =>
  `import { AuthResetPassword } from "@/components/auth/auth-reset-password";
import type { RealmConfig } from "alepha/api/users";

export interface AuthResetPasswordPageProps {
  realmConfig: RealmConfig;
}

const AuthResetPasswordPage = (props: AuthResetPasswordPageProps) => {
  return <AuthResetPassword realmConfig={props.realmConfig} />;
};

export default AuthResetPasswordPage;
`;

export const saasAuthVerifyEmailTsx = () =>
  `import { AuthVerifyEmail } from "@/components/auth/auth-verify-email";

const AuthVerifyEmailPage = () => {
  return <AuthVerifyEmail />;
};

export default AuthVerifyEmailPage;
`;
