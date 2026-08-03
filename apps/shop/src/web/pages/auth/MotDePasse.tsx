import { AuthResetPassword } from "@alepha/ui/components/auth/auth-reset-password";
import type { RealmConfig } from "alepha/api/users";

export interface MotDePasseProps {
  realmConfig: RealmConfig;
}

const MotDePasse = (props: MotDePasseProps) => (
  <AuthResetPassword realmConfig={props.realmConfig} />
);

export default MotDePasse;
