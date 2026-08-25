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
    } else if (this.storeTimeout[key] != null) {
      // A value written without an expiry must not inherit the previous
      // value's timer and vanish under its new holder.
      this.storeTimeout[key].clear();
      delete this.storeTimeout[key];
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

  /**
   * Same compare-and-delete as the base class, minus the `await` between the
   * read and the delete: another task scheduled in that gap could take the
   * lock over and have it deleted out from under it. Nothing here is I/O, so
   * there is no reason to yield at all.
   */
  public override async delIfOwner(
    key: string,
    ownerId: string,
  ): Promise<boolean> {
    const value = this.store[key];
    if (value == null) {
      return false;
    }

    const sep = value.indexOf(",");
    const owner = sep === -1 ? value : value.slice(0, sep);
    if (owner !== ownerId) {
      return false;
    }

    delete this.store[key];
    if (this.storeTimeout[key] != null) {
      this.storeTimeout[key].clear();
      delete this.storeTimeout[key];
    }

    return true;
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
