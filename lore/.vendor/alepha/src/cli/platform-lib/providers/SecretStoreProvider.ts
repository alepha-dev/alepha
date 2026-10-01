/**
 * A secret stored in a remote secret store.
 */
export interface RemoteSecret {
  name: string;
  updatedAt?: string;
}

/**
 * Abstract provider for managing secrets in an external store.
 *
 * Implementations: GitHubSecretStore, MemorySecretStore
 */
export abstract class SecretStoreProvider {
  /**
   * Verify the backing store is reachable and authenticated.
   */
  abstract ensureAvailable(): Promise<void>;

  /**
   * Ensure the target environment exists in the store, creating it if needed.
   */
  abstract ensureEnvironment(environment: string): Promise<void>;

  /**
   * List all secrets in a given environment.
   */
  abstract list(environment: string): Promise<RemoteSecret[]>;

  /**
   * Set (create or update) a secret in a given environment.
   */
  abstract set(environment: string, key: string, value: string): Promise<void>;

  /**
   * Delete a secret from a given environment.
   */
  abstract delete(environment: string, key: string): Promise<void>;
}
