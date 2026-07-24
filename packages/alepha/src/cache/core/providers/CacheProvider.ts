import { CacheError } from "../errors/CacheError.ts";

/**
 * Cache provider interface.
 *
 * All methods are asynchronous and return promises.
 * Values are stored as Uint8Array.
 */
export abstract class CacheProvider {
  protected encoder: TextEncoder = new TextEncoder();
  protected decoder: TextDecoder = new TextDecoder();
  protected codes = {
    BINARY: 0x01,
    JSON: 0x02,
    STRING: 0x03,
    COMPRESSED: 0x04,
  };

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
   * @param ttl Optional counter lifetime in milliseconds. Applied when the
   * counter is created (fixed window — increments do not extend it); once
   * elapsed the counter starts fresh. Without it, counters never expire and
   * any rate limiter built on them becomes a permanent lock-out.
   * @returns The new value after incrementing.
   */
  public abstract incr(
    name: string,
    key: string,
    amount: number,
    ttl?: number,
  ): Promise<number>;

  // ---------------------------------------------------------------------------
  // High-level methods — serialize/compress layer used by CachePrimitive
  // ---------------------------------------------------------------------------

  /**
   * Set a typed value with automatic serialization and optional compression.
   */
  public async setTyped(
    name: string,
    key: string,
    value: unknown,
    options?: { ttl?: number; compress?: boolean },
  ): Promise<void> {
    let data = this.serialize(value);
    if (options?.compress) {
      data = await this.compress(data);
    }
    await this.set(name, key, data, options?.ttl);
  }

  /**
   * Get a typed value with automatic deserialization and optional decompression.
   */
  public async getTyped<T>(name: string, key: string): Promise<T | undefined> {
    const data = await this.get(name, key);
    if (data) {
      if (data[0] === this.codes.COMPRESSED) {
        const decompressed = await this.decompress(data.subarray(1));
        return this.deserialize<T>(decompressed);
      }
      return this.deserialize<T>(data);
    }
    return undefined;
  }

  /**
   * Invalidate cache keys with wildcard support.
   *
   * Keys ending in `*` are expanded via `this.keys()`.
   * Called with no keys, delegates to `this.del(name)` which clears the entire container.
   */
  public async invalidateKeys(name: string, keys: string[]): Promise<void> {
    const keysToDelete: string[] = [];

    for (const key of keys) {
      if (key.endsWith("*")) {
        const result = await this.keys(name, key.slice(0, -1));
        keysToDelete.push(...result);
      } else {
        keysToDelete.push(key);
      }
    }

    // A wildcard that matched nothing must be a no-op: falling through to
    // `del(name)` with zero keys would wipe the entire container.
    if (keys.length > 0 && keysToDelete.length === 0) {
      return;
    }

    await this.del(name, ...keysToDelete);
  }

  /**
   * Serialize a value to a typed Uint8Array with a leading type marker byte.
   */
  protected serialize(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) {
      const result = new Uint8Array(1 + value.length);
      result[0] = this.codes.BINARY;
      result.set(value, 1);
      return result;
    }

    const encoded = this.encoder.encode(
      typeof value === "string" ? value : JSON.stringify(value),
    );
    const code =
      typeof value === "string" ? this.codes.STRING : this.codes.JSON;
    const result = new Uint8Array(1 + encoded.length);
    result[0] = code;
    result.set(encoded, 1);
    return result;
  }

  /**
   * Deserialize a typed Uint8Array back to the original value.
   */
  protected deserialize<T>(uint8Array: Uint8Array): T {
    const type = uint8Array[0];
    const payload = uint8Array.slice(1);

    if (type === this.codes.BINARY) {
      return payload as T;
    }
    if (type === this.codes.JSON) {
      return JSON.parse(this.decoder.decode(payload)) as T;
    }
    if (type === this.codes.STRING) {
      return this.decoder.decode(payload) as T;
    }

    // Counters written by Redis INCRBY / KV incr are raw ASCII digits with no
    // type marker — reading them back must work like on Memory/Database.
    const text = this.decoder.decode(uint8Array);
    if (/^-?\d+$/.test(text)) {
      return Number.parseInt(text, 10) as T;
    }

    throw new CacheError(`Unknown serialization type: ${type}`);
  }

  /**
   * Compress data with gzip, prepending a COMPRESSED marker byte.
   */
  protected async compress(data: Uint8Array): Promise<Uint8Array> {
    const buf = (data.buffer as ArrayBuffer).slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    );
    const compressed = new Uint8Array(
      await new Response(
        new Blob([buf]).stream().pipeThrough(new CompressionStream("gzip")),
      ).arrayBuffer(),
    );
    const result = new Uint8Array(1 + compressed.length);
    result[0] = this.codes.COMPRESSED;
    result.set(compressed, 1);
    return result;
  }

  /**
   * Decompress gzipped data.
   */
  protected async decompress(data: Uint8Array): Promise<Uint8Array> {
    const buf = (data.buffer as ArrayBuffer).slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    );
    return new Uint8Array(
      await new Response(
        new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer(),
    );
  }
}
