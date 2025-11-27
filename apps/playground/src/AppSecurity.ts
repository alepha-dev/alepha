import { $userRealm } from "alepha/api/users";

export class AppSecurity {
  realm = $userRealm({
    identities: {
      google: true,
      credentials: true,
      github: true,
    },
  });
}
