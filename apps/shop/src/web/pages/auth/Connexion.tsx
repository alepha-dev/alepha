import { AuthLogin } from "@alepha/ui/components/auth/auth-login";
import type { RealmConfig } from "alepha/api/users";

export interface ConnexionProps {
  realmConfig: RealmConfig;
}

/**
 * Sign-in, entirely from `@alepha/ui`. The realm config drives which fields and
 * providers the form offers, so turning on a social login or making email
 * verification mandatory changes this screen without touching it.
 */
const Connexion = (props: ConnexionProps) => (
  <AuthLogin realmConfig={props.realmConfig} />
);

export default Connexion;
