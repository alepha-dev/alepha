import { AuthLogin } from "@alepha/ui/auth";
import type { RealmConfig } from "alepha/api/users";

import PageHeader from "../shared/header/PageHeader.tsx";
import AuthBrand from "./AuthBrand.tsx";

export interface AuthLoginPageProps {
  realmConfig: RealmConfig;
}

const AuthLoginPage = (props: AuthLoginPageProps) => {
  return (
    <>
      <PageHeader />
      <AuthLogin realmConfig={props.realmConfig} logo={<AuthBrand />} />
    </>
  );
};

export default AuthLoginPage;
