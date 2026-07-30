import { AuthRegister } from "@alepha/ui/components/auth/auth-register";
import type { RealmConfig } from "alepha/api/users";

export interface AuthRegisterPageProps {
  realmConfig: RealmConfig;
}

/**
 * Sign-up page — reachable only during the initial bootstrap.
 *
 * `PULSE_ALLOW_REGISTRATION` gates the realm, so with the flag unset the realm
 * rejects registration and the login page stops linking here. The page itself
 * stays routed: a route that 404s while the realm still advertises sign-up is
 * worse than one that renders a form the server will refuse.
 */
const AuthRegisterPage = (props: AuthRegisterPageProps) => {
  return (
    <AuthRegister realmConfig={props.realmConfig} loginPath="/auth/login" />
  );
};

export default AuthRegisterPage;
