/**
 * RFC 8414 — OAuth 2.0 Authorization Server Metadata.
 * `baseUrl` is the absolute origin of the deployment (e.g. https://app.com).
 */
export const buildAuthorizationServerMetadata = (baseUrl: string) => ({
  issuer: baseUrl,
  authorization_endpoint: `${baseUrl}/oauth/authorize`,
  token_endpoint: `${baseUrl}/oauth/token`,
  registration_endpoint: `${baseUrl}/oauth/register`,
  // RFC 8628 §4: advertised so a device can discover the grant instead of
  // having the path configured into it.
  device_authorization_endpoint: `${baseUrl}/oauth/device_authorization`,
  jwks_uri: `${baseUrl}/oauth/jwks`,
  response_types_supported: ["code"],
  grant_types_supported: [
    "authorization_code",
    "refresh_token",
    "urn:ietf:params:oauth:grant-type:device_code",
  ],
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
