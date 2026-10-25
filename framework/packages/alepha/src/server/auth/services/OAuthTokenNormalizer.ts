/**
 * Converts provider-specific response fields before the stored token schema
 * strips unknown keys. Keycloak's refresh lifetime uses a different name.
 */
export class OAuthTokenNormalizer {
  public normalize<T extends object>(
    tokens: T,
  ): T & { refresh_token_expires_in?: number } {
    const normalized = { ...tokens } as Record<string, unknown>;
    const legacyLifetime = normalized.refresh_expires_in;
    delete normalized.refresh_expires_in;
    if (
      typeof normalized.refresh_token_expires_in !== "number" &&
      typeof legacyLifetime === "number"
    ) {
      normalized.refresh_token_expires_in = legacyLifetime;
    }
    return normalized as T & { refresh_token_expires_in?: number };
  }
}
