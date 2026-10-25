import { AlephaError } from "alepha";
import type { IssuerPrimitive } from "alepha/security";

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
  realm: IssuerPrimitive & WithLoginFn,
  options: Partial<CredentialsOptions> = {},
) => {
  const name = "credentials";

  // An explicit `account` wins over the realm's default, like every other
  // provider.
  const account: CredentialsFn | undefined =
    options.account ?? (realm.login ? realm.login(name) : undefined);

  if (!account) {
    throw new AlephaError(
      "Credentials authentication requires a login function in the realm primitive.",
    );
  }

  return $auth({
    issuer: realm,
    name,
    credentials: {
      account,
    },
  });
};
