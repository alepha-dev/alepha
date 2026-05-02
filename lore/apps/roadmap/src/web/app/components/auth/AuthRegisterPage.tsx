import { AuthRegister } from "@alepha/ui/components/auth/auth-register";
import type { RealmConfig } from "alepha/api/users";

export interface AuthRegisterPageProps {
  realmConfig: RealmConfig;
}

const AuthRegisterPage = (props: AuthRegisterPageProps) => {
  return <AuthRegister realmConfig={props.realmConfig} />;
};

export default AuthRegisterPage;
