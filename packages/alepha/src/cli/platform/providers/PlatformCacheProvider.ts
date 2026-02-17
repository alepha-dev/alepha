import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { FileSystemProvider } from "alepha/system";

interface PlatformCache {
  [adapter: string]: {
    lastLoginCheck: number;
    accountId?: string;
  };
}

/**
 * Caches cloud provider login state to avoid slow auth checks.
 *
 * Stored in node_modules/.alepha/platform.json (gitignored, project-scoped).
 * TTL: 4 hours.
 */
export class PlatformCacheProvider {
  protected static readonly TTL_MS = 4 * 60 * 60 * 1000;

  protected readonly fs = $inject(FileSystemProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  protected cachePath(root: string): string {
    return this.fs.join(root, "node_modules", ".alepha", "platform.json");
  }

  public async isLoginFresh(root: string, adapter: string): Promise<boolean> {
    const cache = await this.readCache(root);
    const entry = cache[adapter];
    if (!entry) {
      return false;
    }
    const age = this.dateTime.nowMillis() - entry.lastLoginCheck;
    return age < PlatformCacheProvider.TTL_MS;
  }

  public async getAccountId(
    root: string,
    adapter: string,
  ): Promise<string | undefined> {
    const cache = await this.readCache(root);
    return cache[adapter]?.accountId;
  }

  public async recordLogin(
    root: string,
    adapter: string,
    accountId?: string,
  ): Promise<void> {
    const cache = await this.readCache(root);
    cache[adapter] = {
      lastLoginCheck: this.dateTime.nowMillis(),
      accountId,
    };
    await this.writeCache(root, cache);
  }

  protected async readCache(root: string): Promise<PlatformCache> {
    const path = this.cachePath(root);
    try {
      return await this.fs.readJsonFile<PlatformCache>(path);
    } catch {
      return {};
    }
  }

  protected async writeCache(
    root: string,
    cache: PlatformCache,
  ): Promise<void> {
    const path = this.cachePath(root);
    const lastSlash = path.lastIndexOf("/");
    const dir = lastSlash > 0 ? path.slice(0, lastSlash) : path;
    await this.fs.mkdir(dir, { recursive: true }).catch(() => null);
    await this.fs.writeFile(path, JSON.stringify(cache, null, 2));
  }
}
