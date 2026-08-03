import { AuthRegister } from "@alepha/ui/components/auth/auth-register";
import type { RealmConfig } from "alepha/api/users";

export interface InscriptionProps {
  realmConfig: RealmConfig;
}

const Inscription = (props: InscriptionProps) => (
  // Same reason as `Connexion`: the defaults point at `/auth/login`.
  <AuthRegister
    realmConfig={props.realmConfig}
    loginPath="/compte/connexion"
    cancelPath="/"
  />
);

export default Inscription;
