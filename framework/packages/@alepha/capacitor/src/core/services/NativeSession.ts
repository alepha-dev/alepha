import { $inject, Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { ReactBootHealth } from "alepha/react/router";
import { HttpClient } from "alepha/server";
import {
  alephaServerAuthRoutes,
  type Tokens,
  tokensSchema,
} from "alepha/server/auth";

import { CapacitorConfigProvider } from "../providers/CapacitorConfigProvider.ts";
import { TokenStorageProvider } from "../providers/TokenStorageProvider.ts";

/**
 * The tokens of a native app's session: kept in secure storage, refreshed
 * before they expire, dropped when the server says they are no longer valid.
 *
 * - **Refresh** runs a minute before the access token expires, and a single
 *   refresh is shared by every caller that asks during it.
 * - **A request with no response** (no network, an API down) keeps the
 *   tokens: the session may well be fine, the phone is offline.
 * - **An answer refusing the refresh token** clears them: the session was
 *   revoked or expired on the server.
 * - **Sign-out** bumps a generation counter, so a refresh still in flight
 *   when the user signed out cannot bring the session back.
 *
 * Stored under a key namespaced by app id, API origin and realm, so two
 * variants or two APIs on one phone never read each other's session.
 */
export class NativeSession {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly http = $inject(HttpClient);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly storage = $inject(TokenStorageProvider);
  protected readonly config = $inject(CapacitorConfigProvider);
  protected readonly bootHealth = $inject(ReactBootHealth);

  /**
   * Refresh this long before the access token expires.
   */
  public refreshMargin = 60_000;

  protected current?: Tokens;

  /**
   * The storage keys the current session was read from or written to, so a
   * sign-out removes exactly those, whatever the configuration says by then.
   */
  protected keys?: { pointer: string; session: string };

  protected generation = 0;
  protected refreshing?: Promise<void>;

  /**
   * The API origin and app id the session belongs to.
   */
  protected scope(): { apiUrl: string; appId: string } {
    const config = this.config.get();
    if (!config?.apiUrl) {
      throw new AlephaError(
        "A native session needs the shell's public config with an apiUrl: build the app with alepha capacitor.",
      );
    }
    return { apiUrl: config.apiUrl, appId: config.appId };
  }

  /**
   * The key holding the realm of the last session, which names the key that
   * holds the session itself.
   */
  protected pointerKey(): string {
    const { appId, apiUrl } = this.scope();
    return `alepha:${appId}:${apiUrl}`;
  }

  protected sessionKey(realm: string | undefined): string {
    return `${this.pointerKey()}:${realm ?? "-"}`;
  }

  public hasSession(): boolean {
    return this.current !== undefined;
  }

  /**
   * Read the stored session, if any. True when there is one.
   */
  public async load(): Promise<boolean> {
    const realm = await this.storage.get(this.pointerKey());
    if (realm === undefined) {
      return false;
    }
    const keys = {
      pointer: this.pointerKey(),
      session: this.sessionKey(realm || undefined),
    };
    const raw = await this.storage.get(keys.session);
    if (!raw) {
      return false;
    }
    try {
      this.current = tokensSchema.parse(JSON.parse(raw));
      this.keys = keys;
      return true;
    } catch {
      // Unreadable: drop it rather than fail every boot on it.
      await this.storage.remove(keys.session);
      await this.storage.remove(keys.pointer);
      return false;
    }
  }

  /**
   * Keep the tokens of a sign-in or a refresh.
   */
  public async save(tokens: Tokens): Promise<void> {
    this.current = tokens;
    this.keys = {
      pointer: this.pointerKey(),
      session: this.sessionKey(tokens.realm),
    };
    await this.storage.set(this.keys.pointer, tokens.realm ?? "");
    await this.storage.set(this.keys.session, JSON.stringify(tokens));
  }

  /**
   * Forget the session, here and in storage. Any refresh in flight is
   * disowned.
   */
  public async clear(): Promise<void> {
    this.generation++;
    const keys = this.keys;
    this.current = undefined;
    this.keys = undefined;
    if (keys) {
      await this.storage.remove(keys.session);
      await this.storage.remove(keys.pointer);
    }
  }

  /**
   * The access token to send, refreshed first when it is about to expire.
   * `undefined` without a session. A refresh that got no response leaves the
   * current token in place.
   */
  public async accessToken(): Promise<string | undefined> {
    if (!this.current) {
      return undefined;
    }
    if (this.expiresSoon(this.current)) {
      try {
        await this.refresh();
      } catch (error) {
        if (!this.bootHealth.isNetworkError(error)) {
          throw error;
        }
      }
    }
    return this.current?.access_token;
  }

  /**
   * Refresh the session. Concurrent callers share one request.
   */
  public refresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  protected expiresSoon(tokens: Tokens): boolean {
    if (!tokens.expires_in) {
      return false;
    }
    const expiresAt = (tokens.issued_at + tokens.expires_in) * 1000;
    return this.dateTime.nowMillis() >= expiresAt - this.refreshMargin;
  }

  protected async doRefresh(): Promise<void> {
    const tokens = this.current;
    if (!tokens?.refresh_token) {
      throw new AlephaError("The session has no refresh token.");
    }
    const generation = this.generation;
    const { apiUrl } = this.scope();
    const realm = tokens.realm
      ? `&realm=${encodeURIComponent(tokens.realm)}`
      : "";

    let refreshed: Tokens;
    try {
      const { data } = await this.http.fetch(
        `${apiUrl}${alephaServerAuthRoutes.refresh}?provider=${encodeURIComponent(tokens.provider)}${realm}`,
        {
          method: "POST",
          credentials: "omit",
          body: JSON.stringify({
            refresh_token: tokens.refresh_token,
            access_token: tokens.access_token,
          }),
          schema: { response: tokensSchema },
        },
      );
      refreshed = data;
    } catch (error) {
      if (this.bootHealth.isNetworkError(error)) {
        this.log.warn("Session refresh got no response, keeping the session");
        throw error;
      }
      // The server answered and refused: the session is over.
      if (generation === this.generation) {
        this.log.info("Session refresh refused, signing out locally");
        await this.clear();
      }
      throw error;
    }

    if (generation !== this.generation) {
      // Signed out while the refresh was in flight: drop its result.
      return;
    }
    await this.save({
      ...refreshed,
      refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
    });
  }
}
