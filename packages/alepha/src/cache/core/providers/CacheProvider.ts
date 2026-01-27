/**
 * Cache provider interface.
 *
 * All methods are asynchronous and return promises.
 * Values are stored as Uint8Array.
 */
export abstract class CacheProvider {
  /**
   * Get the value of a key.
   *
   * @param name Cache name, used to group keys. Should be Redis-like "some:group:name" format.
   * @param key The key of the value to get.
   *
   * @return The value of the key, or undefined if the key does not exist.
   */
  public abstract get(
    name: string,
    key: string,
  ): Promise<Uint8Array | undefined>;

  /**
   * Set the string value of a key.
   *
   * @param name Cache name, used to group keys. Should be Redis-like "some:group:name" format.
   * @param key The key of the value to set.
   * @param value The value to set.
   * @param ttl The time-to-live of the key, in milliseconds.
   *
   * @return The value of the key.
   */
  public abstract set(
    name: string,
    key: string,
    value: Uint8Array,
    ttl?: number,
  ): Promise<Uint8Array>;

  /**
   * Remove the specified keys.
   *
   * @param name Cache name, used to group keys. Should be Redis-like "some:group:name" format.
   * @param keys The keys to delete.
   */
  public abstract del(name: string, ...keys: string[]): Promise<void>;

  public abstract has(name: string, key: string): Promise<boolean>;

  public abstract keys(name: string, filter?: string): Promise<string[]>;

  /**
   * Remove all keys from all cache names.
   */
  public abstract clear(): Promise<void>;

  /**
   * Increment the integer value of a key by the given amount.
   *
   * If the key does not exist, it is set to 0 before performing the operation.
   * This operation is atomic when using Redis.
   *
   * @param name Cache name, used to group keys.
   * @param key The key to increment.
   * @param amount The amount to increment by.
   * @returns The new value after incrementing.
   */
  public abstract incr(
    name: string,
    key: string,
    amount: number,
  ): Promise<number>;
}
