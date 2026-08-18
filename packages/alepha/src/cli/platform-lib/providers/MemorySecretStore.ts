import { AlephaError } from "alepha";
import type {
  RemoteSecret,
  SecretStoreProvider,
} from "./SecretStoreProvider.ts";

export interface MemorySecretStoreCall {
  method: "ensureAvailable" | "ensureEnvironment" | "list" | "set" | "delete";
  environment?: string;
  key?: string;
  value?: string;
}

/**
 * In-memory implementation of SecretStoreProvider for testing.
 * Records all operations and stores secrets in a nested Map.
 */
export class MemorySecretStore implements SecretStoreProvider {
  /**
   * Secrets keyed by environment, then by key.
   */
  public secrets = new Map<string, Map<string, string>>();

  /**
   * Push timestamps (ISO 8601), keyed by environment then by key.
   *
   * Separate from {@link secrets} and never written by {@link set}: a test
   * double has no clock, and the assertions that need a timestamp need to
   * choose it. A key absent here lists with no `updatedAt`, which is also the
   * real store's answer when GitHub reports none.
   */
  public updatedAt = new Map<string, Map<string, string>>();

  /**
   * All recorded operations.
   */
  public calls: MemorySecretStoreCall[] = [];

  /**
   * When set, ensureAvailable() will throw with this message.
   */
  public availableError: string | null = null;

  public async ensureAvailable(): Promise<void> {
    this.calls.push({ method: "ensureAvailable" });
    if (this.availableError) {
      throw new AlephaError(this.availableError);
    }
  }

  public async ensureEnvironment(environment: string): Promise<void> {
    this.calls.push({ method: "ensureEnvironment", environment });
    if (!this.secrets.has(environment)) {
      this.secrets.set(environment, new Map());
    }
  }

  public async list(environment: string): Promise<RemoteSecret[]> {
    this.calls.push({ method: "list", environment });
    const envSecrets = this.secrets.get(environment);
    if (!envSecrets) return [];

    const stamps = this.updatedAt.get(environment);
    return Array.from(envSecrets.keys()).map((name) => ({
      name,
      updatedAt: stamps?.get(name),
    }));
  }

  public async set(
    environment: string,
    key: string,
    value: string,
  ): Promise<void> {
    this.calls.push({ method: "set", environment, key, value });

    let envSecrets = this.secrets.get(environment);
    if (!envSecrets) {
      envSecrets = new Map();
      this.secrets.set(environment, envSecrets);
    }
    envSecrets.set(key, value);
  }

  public async delete(environment: string, key: string): Promise<void> {
    this.calls.push({ method: "delete", environment, key });
    this.secrets.get(environment)?.delete(key);
  }

  /**
   * Check if set() was called for a given environment and key.
   */
  public wasSet(environment: string, key: string): boolean {
    return this.calls.some(
      (c) =>
        c.method === "set" && c.environment === environment && c.key === key,
    );
  }

  /**
   * Check if delete() was called for a given environment and key.
   */
  public wasDeleted(environment: string, key: string): boolean {
    return this.calls.some(
      (c) =>
        c.method === "delete" && c.environment === environment && c.key === key,
    );
  }

  /**
   * Get all set() calls for a given environment.
   */
  public getSetCalls(
    environment: string,
  ): Array<{ key: string; value: string }> {
    return this.calls
      .filter((c) => c.method === "set" && c.environment === environment)
      .map((c) => ({ key: c.key!, value: c.value! }));
  }

  /**
   * Reset all state.
   */
  public reset(): void {
    this.secrets.clear();
    this.updatedAt.clear();
    this.calls = [];
    this.availableError = null;
  }
}
