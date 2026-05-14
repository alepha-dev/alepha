import { AuthLogin } from "@alepha/ui/components/auth/auth-login";
import type { RealmConfig } from "alepha/api/users";
import PageHeader from "../shared/header/PageHeader.tsx";

export interface AuthLoginPageProps {
  realmConfig: RealmConfig;
}

const AuthLoginPage = (props: AuthLoginPageProps) => {
  return (
    <>
      <PageHeader />
      <AuthLogin realmConfig={props.realmConfig} />
    </>
  );
};

export default AuthLoginPage;
