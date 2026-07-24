/**
 * Store Provider Interface
 */
export abstract class LockProvider {
  /**
   * Set the string value of a key.
   *
   * @param key The key of the value to set.
   * @param value The value to set.
   * @param nx If set to true, the key will only be set if it does not already exist.
   * @param px Set the specified expire time, in milliseconds.
   */
  public abstract set(
    key: string,
    value: string,
    nx?: boolean,
    px?: number,
  ): Promise<string>;

  /**
   * Remove the specified keys.
   *
   * @param keys The keys to delete.
   */
  public abstract del(...keys: string[]): Promise<void>;

  /**
   * Get the current value of a key, or undefined if absent.
   */
  public abstract get(key: string): Promise<string | undefined>;

  /**
   * Delete the key only if it is currently owned by `ownerId`.
   *
   * Lock values are stored as `ownerId,<metadata...>`; the owner is the
   * segment before the first comma. This is the safe-release primitive: a
   * holder whose lock already expired must not delete the next holder's
   * lock. Providers with atomic conditional deletes (e.g. Redis Lua) may
   * override this default read-compare-delete implementation.
   */
  public async delIfOwner(key: string, ownerId: string): Promise<boolean> {
    const value = await this.get(key);
    if (value == null) {
      return false;
    }

    const sep = value.indexOf(",");
    const owner = sep === -1 ? value : value.slice(0, sep);
    if (owner !== ownerId) {
      return false;
    }

    await this.del(key);
    return true;
  }
}
