import { AuthRegister } from "@alepha/ui/components/auth/auth-register";
import type { RealmConfig } from "alepha/api/users";
import PageHeader from "../shared/header/PageHeader.tsx";

export interface AuthRegisterPageProps {
  realmConfig: RealmConfig;
}

const AuthRegisterPage = (props: AuthRegisterPageProps) => {
  return (
    <>
      <PageHeader />
      <AuthRegister realmConfig={props.realmConfig} />
    </>
  );
};

export default AuthRegisterPage;
