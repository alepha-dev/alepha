import { $context, AlephaError, z } from "alepha";
import type { IssuerPrimitive } from "alepha/security";

import {
  $auth,
  type LinkAccountFn,
  type OidcOptions,
  type WithLinkFn,
} from "./$auth.ts";

/**
 * Already configured Microsoft Entra ID (Azure AD) authentication primitive.
 *
 * Uses OpenID Connect (OIDC) to authenticate users via their Microsoft accounts.
 * Supports personal Microsoft accounts, work/school (Azure AD) accounts, and
 * multi-tenant applications.
 *
 * The tenant ID defaults to `"common"`, which allows all Microsoft account types
 * (personal, work, school). To restrict to a specific Azure AD tenant, set
 * `MICROSOFT_TENANT_ID` to your tenant's GUID or domain.
 *
 * **Note on multi-tenant issuer validation**: Microsoft's OIDC discovery document
 * for the `common` endpoint returns `{tenantid}` as a literal placeholder in the
 * `issuer` field. This is expected behavior for multi-tenant endpoints. The
 * openid-client library handles this during token validation automatically.
 *
 * Environment Variables:
 * - `MICROSOFT_CLIENT_ID`: The application (client) ID from the Azure Portal.
 * - `MICROSOFT_CLIENT_SECRET`: The client secret value from the Azure Portal.
 * - `MICROSOFT_TENANT_ID`: (Optional) Azure AD tenant ID or `"common"` for
 *   multi-tenant. Defaults to `"common"`.
 */
export const $authMicrosoft = (
  realm: IssuerPrimitive & WithLinkFn,
  options: Partial<OidcOptions> = {},
) => {
  const { alepha } = $context();

  const env = alepha.parseEnv(
    z.object({
      MICROSOFT_CLIENT_ID: z
        .text({
          // Public: it travels in the authorize URL the browser is sent to.
          secret: false,
          description:
            "The application (client) ID obtained from the Azure Portal.",
        })
        .optional(),
      MICROSOFT_CLIENT_SECRET: z
        .text({
          description:
            "The client secret value obtained from the Azure Portal.",
        })
        .optional(),
      MICROSOFT_TENANT_ID: z
        .text({
          // Public: it is a path segment of the authorize URL.
          secret: false,
          description:
            "The Azure AD tenant ID or 'common' for multi-tenant. Defaults to 'common'.",
        })
        .optional(),
    }),
  );

  const disabled = !env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET;

  const tenantId = env.MICROSOFT_TENANT_ID ?? "common";

  const name = "microsoft";

  const account: LinkAccountFn | undefined =
    options.account ?? (realm.link ? realm.link(name) : undefined);

  if (!account) {
    throw new AlephaError(
      "Authentication requires a link function in the realm primitive.",
    );
  }

  return $auth({
    issuer: realm,
    name,
    oidc: {
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      clientId: env.MICROSOFT_CLIENT_ID!,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      ...options,
      account,
    },
    disabled,
  });
};
