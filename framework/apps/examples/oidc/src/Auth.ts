import { $env, z } from "alepha";
import { $issuer } from "alepha/security";
import { $auth } from "alepha/server/auth";

const env = z.object({
  OIDC_ISSUER: z.text({
    default: "http://localhost:8080/realms/acme",
    description: "The identity provider's issuer URL.",
  }),
  OIDC_CLIENT_ID: z.text({ default: "acme-web" }),
});

/**
 * The whole server half of a relying party: one provider, and the issuer that
 * verifies its tokens.
 *
 * There is no user table. The `$auth` has no `issuer` of its own, so a
 * sign-in keeps the provider's tokens, encrypted, in the session cookie, and
 * every request reads the person from the access token.
 */
export class Auth {
  protected readonly env = $env(env);

  /**
   * The provider: discovery, PKCE, the token exchange, refresh and logout.
   * A public client, so no secret.
   */
  public readonly keycloak = $auth({
    oidc: {
      issuer: this.env.OIDC_ISSUER,
      clientId: this.env.OIDC_CLIENT_ID,
    },
  });

  /**
   * Verifies the provider's access tokens, on every request that carries
   * one: the session cookie's, or a bearer token.
   */
  public readonly issuer = $issuer({
    name: "keycloak",
    jwks: () => `${this.env.OIDC_ISSUER}/protocol/openid-connect/certs`,
  });
}
