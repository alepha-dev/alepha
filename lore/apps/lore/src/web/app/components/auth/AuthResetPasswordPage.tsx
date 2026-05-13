import { AuthResetPassword } from "@alepha/ui/components/auth/auth-reset-password";
import type { RealmConfig } from "alepha/api/users";
import PageHeader from "../shared/header/PageHeader.tsx";

export interface AuthResetPasswordPageProps {
  realmConfig: RealmConfig;
}

const AuthResetPasswordPage = (props: AuthResetPasswordPageProps) => {
  return (
    <>
      <PageHeader />
      <AuthResetPassword realmConfig={props.realmConfig} />
    </>
  );
};

export default AuthResetPasswordPage;
