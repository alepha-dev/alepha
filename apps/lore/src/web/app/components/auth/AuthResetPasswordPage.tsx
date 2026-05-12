import { AuthResetPassword } from "@alepha/ui/components/auth/auth-reset-password";
import type { RealmConfig } from "alepha/api/users";

export interface AuthResetPasswordPageProps {
  realmConfig: RealmConfig;
}

const AuthResetPasswordPage = (props: AuthResetPasswordPageProps) => {
  return <AuthResetPassword realmConfig={props.realmConfig} />;
};

export default AuthResetPasswordPage;
