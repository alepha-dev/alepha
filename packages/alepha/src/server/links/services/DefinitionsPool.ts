/**
 * Builds a deduplicated pool of pre-stringified JSON Schema definitions.
 *
 * Each unique schema is stored once and assigned a `$N` reference key.
 * Actions reference schemas via these keys instead of inlining the full JSON.
 *
 * Runs at startup (registration time), not on the hot path.
 */
export class DefinitionsPool {
  protected pool = new Map<string, string>();
  protected counter = 0;

  /**
   * Register a schema and return its `$N` reference key.
   * If the same schema was already registered, returns the existing key.
   */
  ref(schema: object | undefined): string | undefined {
    if (!schema) return undefined;
    const json = JSON.stringify(schema);
    const existing = this.pool.get(json);
    if (existing) return existing;
    const key = `$${this.counter++}`;
    this.pool.set(json, key);
    return key;
  }

  /**
   * Returns the definitions as `{ "$0": "json string", "$1": "..." }`.
   * Keys are `$N` refs, values are pre-stringified JSON Schema.
   */
  toJSON(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [json, key] of this.pool) result[key] = json;
    return result;
  }

  /**
   * Number of unique definitions in the pool.
   */
  get size(): number {
    return this.pool.size;
  }
}
