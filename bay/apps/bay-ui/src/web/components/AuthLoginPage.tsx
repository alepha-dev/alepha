import { AuthLogin } from "@alepha/ui/components/auth/auth-login";
import type { RealmConfig } from "alepha/api/users";

export interface AuthLoginPageProps {
  realmConfig: RealmConfig;
}

/**
 * Sign-in page.
 *
 * No "sign up" and no "forgot password" links on purpose: registration is
 * closed in normal operation, and no mail provider is configured, so a reset
 * link would go nowhere.
 */
const AuthLoginPage = (props: AuthLoginPageProps) => {
  return <AuthLogin realmConfig={props.realmConfig} />;
};

export default AuthLoginPage;
