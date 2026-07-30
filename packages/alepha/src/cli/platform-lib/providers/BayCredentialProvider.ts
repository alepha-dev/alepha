import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Stores the credential for each Bay a developer has logged into.
 *
 * **User-scoped, not project-scoped.** `PlatformCacheProvider` lives in
 * `node_modules/.alepha/`, which `yarn clean` removes — fine for a freshness
 * timestamp, wrong for a credential you would then have to re-obtain by hand.
 * And the credential belongs to a *Bay*, not to a checkout: two projects
 * deploying to the same host should share one login, the way `wrangler login`
 * is shared across every project on the machine.
 *
 * Keyed by endpoint for the same reason — one file, many Bays, no collision
 * between a personal host and a company one.
 */
export class BayCredentialProvider {
  protected path(): string {
    // Follows the XDG-ish shape wrangler uses, rather than inventing a location
    // per tool.
    const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
    return join(base, "alepha", "bay.json");
  }

  /**
   * Returns the token for a Bay, or undefined when not logged in.
   *
   * `$BAY_API_KEY` wins, so CI can supply one without a file and without a
   * login — the same code path a laptop uses after `platform auth login`.
   */
  async get(endpoint: string): Promise<string | undefined> {
    if (process.env.BAY_API_KEY) {
      return process.env.BAY_API_KEY;
    }
    const store = await this.read();
    return store[this.normalize(endpoint)];
  }

  async set(endpoint: string, token: string): Promise<void> {
    const store = await this.read();
    store[this.normalize(endpoint)] = token;
    await this.write(store);
  }

  /**
   * Forgets one Bay. Reports whether there was anything to forget, so `logout`
   * can say "you were not logged in" rather than imply it revoked something.
   */
  async clear(endpoint: string): Promise<boolean> {
    const store = await this.read();
    const key = this.normalize(endpoint);
    if (!(key in store)) {
      return false;
    }
    delete store[key];
    await this.write(store);
    return true;
  }

  protected normalize(endpoint: string): string {
    return endpoint.replace(/\/$/, "").toLowerCase();
  }

  protected async read(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.path(), "utf8"));
    } catch {
      // Absent or unreadable: an empty store means "not logged in", which is
      // the honest reading of both.
      return {};
    }
  }

  protected async write(store: Record<string, string>): Promise<void> {
    const path = this.path();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(store, null, 2));
    // Written first, narrowed immediately: between creation and chmod the file
    // carries the process umask, which on most machines is world-readable — and
    // this file grants deploy access to every app on the host.
    await chmod(path, 0o600);
  }
}
