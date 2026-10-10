/**
 * Filters environment variables for secret store syncing.
 *
 * Excludes platform-managed vars (NODE_ENV), build-time vars (VITE_*),
 * and empty values. Keeps everything else — including DATABASE_URL
 * and POSTGRES_SCHEMA which GitHub Actions needs.
 *
 * Also handles renaming GITHUB_* keys since GitHub Actions rejects
 * secret names starting with GITHUB_.
 */
export class SecretFilterService {
  protected static readonly EXCLUDED_KEYS = new Set(["NODE_ENV"]);
  protected static readonly GITHUB_PREFIX = "GITHUB_";
  protected static readonly REMOTE_PREFIX = "APP_GITHUB_";

  /**
   * Return only the entries that should be pushed to a secret store.
   */
  public filter(envVars: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(envVars)) {
      if (!value) continue;
      if (SecretFilterService.EXCLUDED_KEYS.has(key)) continue;
      if (key.startsWith("VITE_")) continue;
      result[key] = value;
    }

    return result;
  }

  /**
   * Convert a local env key to a remote secret name.
   *
   * GITHUB_* keys are prefixed with APP_ since GitHub Actions rejects
   * secret names starting with GITHUB_.
   */
  public toRemoteName(key: string): string {
    if (key.startsWith(SecretFilterService.GITHUB_PREFIX)) {
      return `${SecretFilterService.REMOTE_PREFIX}${key.slice(SecretFilterService.GITHUB_PREFIX.length)}`;
    }
    return key;
  }

  /**
   * Convert a remote secret name back to the local env key.
   */
  public toLocalName(remoteName: string): string {
    if (remoteName.startsWith(SecretFilterService.REMOTE_PREFIX)) {
      return `${SecretFilterService.GITHUB_PREFIX}${remoteName.slice(SecretFilterService.REMOTE_PREFIX.length)}`;
    }
    return remoteName;
  }
}
