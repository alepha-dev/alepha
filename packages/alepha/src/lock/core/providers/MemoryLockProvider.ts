import { $inject } from "alepha";
import { DateTimeProvider, type Timeout } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { LockProvider } from "./LockProvider.ts";

/**
 * A simple in-memory store provider.
 */
export class MemoryLockProvider extends LockProvider {
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly log = $logger();

  /**
   * The in-memory store.
   */
  protected store: Record<string, string> = {};

  /**
   * Timeouts used to expire keys.
   */
  protected storeTimeout: Record<string, Timeout> = {};

  public async set(
    key: string,
    value: string,
    nx?: boolean,
    px?: number,
  ): Promise<string> {
    if (nx && this.store[key] != null) {
      return this.store[key];
    }

    if (px) {
      this.ttl(key, px);
    }

    this.store[key] = value;

    return this.store[key];
  }

  public async get(key: string): Promise<string | undefined> {
    return this.store[key];
  }

  public async del(...keys: string[]): Promise<void> {
    for (const key of keys) {
      delete this.store[key];
      if (this.storeTimeout[key] != null) {
        this.storeTimeout[key].clear();
        delete this.storeTimeout[key];
      }
    }
  }

  protected ttl(key: string, ms: number): void {
    if (this.storeTimeout[key] != null) {
      this.storeTimeout[key].clear();
      delete this.storeTimeout[key];
    }

    this.storeTimeout[key] = this.dateTimeProvider.createTimeout(() => {
      delete this.store[key];
      delete this.storeTimeout[key];
    }, ms);
  }
}
