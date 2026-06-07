/**
 * RFC 8414 — OAuth 2.0 Authorization Server Metadata.
 * `baseUrl` is the absolute origin of the deployment (e.g. https://app.com).
 */
export const buildAuthorizationServerMetadata = (baseUrl: string) => ({
  issuer: baseUrl,
  authorization_endpoint: `${baseUrl}/oauth/authorize`,
  token_endpoint: `${baseUrl}/oauth/token`,
  registration_endpoint: `${baseUrl}/oauth/register`,
  jwks_uri: `${baseUrl}/oauth/jwks`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: ["mcp"],
});

/**
 * RFC 9728 — OAuth 2.0 Protected Resource Metadata.
 * `resource` is the absolute URL of the MCP endpoint being protected.
 */
export const buildProtectedResourceMetadata = (
  baseUrl: string,
  resource: string,
) => ({
  resource,
  authorization_servers: [baseUrl],
  scopes_supported: ["mcp"],
  bearer_methods_supported: ["header"],
});
