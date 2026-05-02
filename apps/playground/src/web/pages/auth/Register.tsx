import { AuthRegister } from "@alepha/ui/components/auth/auth-register";
import type { RealmConfig } from "alepha/api/users";

export interface RegisterPageProps {
  realmConfig: RealmConfig;
}

const RegisterPage = (props: RegisterPageProps) => {
  return <AuthRegister realmConfig={props.realmConfig} />;
};

export default RegisterPage;
