import { AuthResetPassword } from "@alepha/ui/components/auth/auth-reset-password";
import type { RealmConfig } from "alepha/api/users";
import PageHeader from "../shared/header/PageHeader.tsx";
import LoreLogo from "../shared/LoreLogo.tsx";

export interface AuthResetPasswordPageProps {
  realmConfig: RealmConfig;
}

const AuthResetPasswordPage = (props: AuthResetPasswordPageProps) => {
  return (
    <>
      <PageHeader />
      <AuthResetPassword
        realmConfig={props.realmConfig}
        logo={<LoreLogo size={64} className="size-16 animate-floating" />}
      />
    </>
  );
};

export default AuthResetPasswordPage;
