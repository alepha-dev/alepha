import type {
  KVListOptions,
  KVListResult,
  KVPutOptions,
} from "../providers/CloudflareKVProvider.ts";

/**
 * Enough of a KV namespace for the cache specs. It records what reached the
 * binding, so a spec can assert on the `expirationTtl` the provider asked
 * Cloudflare for, or on whether anything was written at all.
 */
export class FakeKV {
  public puts: Array<{ key: string; options?: KVPutOptions }> = [];
  protected store = new Map<string, ArrayBuffer | string>();

  async get(key: string, type?: "text" | "arrayBuffer"): Promise<any> {
    const value = this.store.get(key);
    if (value === undefined) return null;
    // Test fixture: the body is a string the test just wrote.
    // oxlint-disable-next-line typescript/no-base-to-string
    return type === "arrayBuffer" ? value : String(value);
  }

  async put(
    key: string,
    value: string | ArrayBuffer,
    options?: KVPutOptions,
  ): Promise<void> {
    this.puts.push({ key, options });
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: KVListOptions): Promise<KVListResult> {
    const prefix = options?.prefix ?? "";
    return {
      keys: [...this.store.keys()]
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true,
    };
  }
}
