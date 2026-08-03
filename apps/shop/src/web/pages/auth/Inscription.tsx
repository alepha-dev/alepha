import { AuthRegister } from "@alepha/ui/components/auth/auth-register";
import type { RealmConfig } from "alepha/api/users";

export interface InscriptionProps {
  realmConfig: RealmConfig;
}

const Inscription = (props: InscriptionProps) => (
  <AuthRegister realmConfig={props.realmConfig} />
);

export default Inscription;
