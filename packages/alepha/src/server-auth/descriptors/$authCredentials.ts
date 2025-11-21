import { AlephaError } from "alepha";
import type { RealmDescriptor } from "alepha/security";
import {
  $auth,
  type CredentialsFn,
  type CredentialsOptions,
  type WithLoginFn,
} from "./$auth.ts";

/**
 * Already configured Credentials authentication descriptor.
 *
 * Uses username and password to authenticate users.
 */
export const $authCredentials = (
  realm: RealmDescriptor & WithLoginFn,
  options: Partial<CredentialsOptions> = {},
) => {
  const name = "credentials";

  const account: CredentialsFn | undefined = realm.login
    ? realm.login(name)
    : options.account;

  if (!account) {
    throw new AlephaError(
      "Credentials authentication requires a login function in the realm descriptor.",
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
