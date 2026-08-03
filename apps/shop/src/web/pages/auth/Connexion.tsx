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
  /*
   * The paths must be passed. `AuthLogin` falls back to the framework's own
   * `/auth/register` and `/auth/reset-password`, and this shop mounts its auth
   * pages under `/compte/*` — so without these props every cross-link led to a
   * 404, and the 404 had no way back.
   */
  <AuthLogin
    realmConfig={props.realmConfig}
    registerPath="/compte/inscription"
    resetPasswordPath="/compte/mot-de-passe"
  />
);

export default Connexion;
