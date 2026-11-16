import { AuthResetPassword } from "@alepha/ui/auth";
import type { RealmConfig } from "alepha/api/users";

import PageHeader from "../shared/header/PageHeader.tsx";
import AuthBrand from "./AuthBrand.tsx";

export interface AuthResetPasswordPageProps {
  realmConfig: RealmConfig;
}

const AuthResetPasswordPage = (props: AuthResetPasswordPageProps) => {
  return (
    <>
      <PageHeader />
      <AuthResetPassword realmConfig={props.realmConfig} logo={<AuthBrand />} />
    </>
  );
};

export default AuthResetPasswordPage;
