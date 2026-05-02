import { AuthLogin } from "@alepha/ui/components/auth/auth-login";
import type { RealmConfig } from "alepha/api/users";

export interface LoginPageProps {
  realmConfig: RealmConfig;
}

const LoginPage = (props: LoginPageProps) => {
  return <AuthLogin realmConfig={props.realmConfig} />;
};

export default LoginPage;
