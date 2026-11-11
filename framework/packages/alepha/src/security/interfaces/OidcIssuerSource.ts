/**
 * What a federated `$issuer` reads from the provider it verifies tokens for:
 * `$issuer({ oidc: () => this.keycloak })`.
 *
 * Declared here, structurally, because `alepha/security` cannot import
 * `alepha/server/auth`, which imports it: an `$auth({ oidc })` satisfies it as
 * it is.
 */
export interface OidcIssuerSource {
  /**
   * The client id the app is registered under at the provider. A token must
   * name it, in `aud` or else in `azp`.
   */
  readonly clientId: string;

  /**
   * The provider's discovery result, fetched on first use and kept once it
   * succeeds. Never called at boot: a relying party must start while its
   * provider is unreachable.
   */
  getOAuth(): Promise<
    | {
        serverMetadata(): { issuer: string; jwks_uri?: string };
      }
    | undefined
  >;
}

/**
 * What a token of a federated realm must carry, beside a valid signature and
 * expiry.
 */
export interface TokenExpectation {
  /**
   * The `iss` claim, exactly.
   */
  issuer?: string;

  /**
   * One of these in `aud`. Failing that, `azp` must equal
   * {@link TokenExpectation.clientId}, which is how Keycloak's default access
   * token names its client (`aud: "account"`, `azp: <client>`).
   */
  audience?: string | string[];

  /**
   * The client the token was issued to, checked against `azp` when `aud`
   * does not carry the audience. Defaults to `audience` when that is a
   * single value.
   */
  clientId?: string;
}
