import { $inject } from "alepha";
import { $cache } from "alepha/cache";
import type { Duration } from "alepha/datetime";
import { ServerCookiesProvider } from "alepha/server/cookies";

import type { Tokens } from "../schemas/tokensSchema.ts";

/**
 * The server-side session store: a session's tokens by an opaque id, with
 * only `{ provider, realm, id }` in the cookie.
 *
 * Off by default (`serverAuthOptions.sessionStore`), and registered only when
 * on: a declared `$cache` becomes a KV namespace on workerd for an app with no
 * database cache. Stateless stays the default, and an app needs no database
 * to sign users in.
 *
 * On `$cache`: memory in tests and on a single instance, Redis with
 * `REDIS_URL`, the database cache or KV on workerd. No in-memory tier in
 * front: a stale copy would keep an ended session alive. Entries are
 * encrypted at rest with the key the cookie uses: refresh tokens moved out of
 * an encrypted cookie must not land in a clear-text cache.
 *
 * Substitute it to keep sessions elsewhere.
 */
export class SessionStore {
  protected readonly cookies = $inject(ServerCookiesProvider);

  protected readonly sessions = $cache<string>({
    name: "alepha.server.auth.sessions",
  });

  /**
   * KV refuses a TTL under 60 seconds.
   */
  protected static readonly MIN_TTL_SECONDS = 60;

  public async get(id: string): Promise<Tokens | undefined> {
    const sealed = await this.sessions.get(id);
    if (!sealed) {
      return undefined;
    }
    try {
      return JSON.parse(this.cookies.decryptValue(sealed)) as Tokens;
    } catch {
      return undefined;
    }
  }

  public async set(id: string, tokens: Tokens, ttl: Duration): Promise<void> {
    const seconds = Math.max(
      SessionStore.MIN_TTL_SECONDS,
      Math.ceil(ttl.asSeconds()),
    );
    await this.sessions.set(
      id,
      this.cookies.encryptValue(JSON.stringify(tokens)),
      [seconds, "seconds"],
    );
  }

  /**
   * End a session: its cookie signs out on the next request.
   */
  public async delete(id: string): Promise<void> {
    await this.sessions.invalidate(id);
  }
}
