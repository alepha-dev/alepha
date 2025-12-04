import { $userRealm } from "alepha/api/users";

export class AppSecurity {
  realm = $userRealm({
    identities: {
      credentials: true,
      google: true,
    },
  });
}
