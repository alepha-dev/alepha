import { AuthResetPassword } from "@alepha/ui/components/auth/auth-reset-password";
import type { RealmConfig } from "alepha/api/users";

export interface ResetPasswordPageProps {
  realmConfig: RealmConfig;
}

const ResetPasswordPage = (props: ResetPasswordPageProps) => {
  return <AuthResetPassword realmConfig={props.realmConfig} />;
};

export default ResetPasswordPage;
