import { AlephaError } from "alepha";
import type { RealmPrimitive } from "alepha/security";
import {
  $auth,
  type CredentialsFn,
  type CredentialsOptions,
  type WithLoginFn,
} from "./$auth.ts";

/**
 * Already configured Credentials authentication primitive.
 *
 * Uses username and password to authenticate users.
 */
export const $authCredentials = (
  realm: RealmPrimitive & WithLoginFn,
  options: Partial<CredentialsOptions> = {},
) => {
  const name = "credentials";

  const account: CredentialsFn | undefined = realm.login
    ? realm.login(name)
    : options.account;

  if (!account) {
    throw new AlephaError(
      "Credentials authentication requires a login function in the realm primitive.",
    );
  }

  return $auth({
    realm,
    name,
    credentials: {
      account,
    },
  });
};
