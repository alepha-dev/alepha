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
}
