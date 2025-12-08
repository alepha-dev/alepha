import { $userRealm } from "alepha/api/users";

export class AppSecurity {
  realm = $userRealm({
    modules: {
      files: true,
    },
    identities: {
      credentials: true,
      google: true,
    },
    settings: {
      usernameEnabled: false,
      verifyEmailRequired: true,
    },
  });
}
