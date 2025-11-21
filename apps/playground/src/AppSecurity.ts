import { $userRealm } from "alepha/api/users";
import { $authCredentials, $authGithub, $authGoogle } from "alepha/server/auth";

export class AppSecurity {
  realm = $userRealm();
  google = $authGoogle(this.realm);
  credentials = $authCredentials(this.realm);
  github = $authGithub(this.realm);
}
