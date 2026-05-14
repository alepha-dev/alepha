import { AuthLogin } from "@alepha/ui/components/auth/auth-login";
import type { RealmConfig } from "alepha/api/users";
import PageHeader from "../shared/header/PageHeader.tsx";
import LoreLogo from "../shared/LoreLogo.tsx";

export interface AuthLoginPageProps {
  realmConfig: RealmConfig;
}

const AuthLoginPage = (props: AuthLoginPageProps) => {
  return (
    <>
      <PageHeader />
      <AuthLogin
        realmConfig={props.realmConfig}
        logo={<LoreLogo size={64} className="size-16 animate-floating" />}
      />
    </>
  );
};

export default AuthLoginPage;
