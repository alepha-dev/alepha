import { TokenStorageProvider } from "./TokenStorageProvider.ts";

/**
 * Session tokens in a map, for specs.
 */
export class MemoryTokenStorageProvider extends TokenStorageProvider {
  public items = new Map<string, string>();

  public override async get(key: string): Promise<string | undefined> {
    return this.items.get(key);
  }

  public override async set(key: string, value: string): Promise<void> {
    this.items.set(key, value);
  }

  public override async remove(key: string): Promise<void> {
    this.items.delete(key);
  }
}
