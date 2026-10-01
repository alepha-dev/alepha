/**
 * OpenID Connect Discovery 1.0 — provider metadata document
 * (`/.well-known/openid-configuration`). `baseUrl` is the absolute origin of
 * the OIDC provider (e.g. https://alepha.club).
 */
export const buildOpenIdConfiguration = (baseUrl: string) => ({
  issuer: baseUrl,
  authorization_endpoint: `${baseUrl}/oauth/authorize`,
  token_endpoint: `${baseUrl}/oauth/token`,
  jwks_uri: `${baseUrl}/oauth/jwks`,
  registration_endpoint: `${baseUrl}/oauth/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["EdDSA", "RS256"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
  scopes_supported: ["openid", "email", "profile"],
});
