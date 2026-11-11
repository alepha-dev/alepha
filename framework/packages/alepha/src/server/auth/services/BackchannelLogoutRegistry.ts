import { $inject } from "alepha";
import { $cache } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { JwtProvider, type KeyLoaderHolder } from "alepha/security";

import type { AuthPrimitive } from "../primitives/$auth.ts";
import type { Tokens } from "../schemas/tokensSchema.ts";

/**
 * The sessions an identity provider ended through OpenID Connect
 * Back-Channel Logout 1.0, and the check a session cookie goes through.
 *
 * A denylist rather than a session store: the session stays stateless, and
 * this records only that a session, or every session of a subject, ended at
 * a given time. One `$cache` entry per `(provider, sid)`, or per
 * `(provider, sub)` when the logout token names no session, kept as long as
 * a session cookie can live.
 *
 * Registered only when a provider opts in (`oidc.backchannelLogout`): a
 * declared `$cache` becomes a KV namespace on workerd for an app with no
 * database cache, which an app that does not use this must not pay for.
 *
 * Its reach is the cache's: with the memory cache a logout reaches one
 * process, two instances need `REDIS_URL`, and KV is eventually consistent.
 */
export class BackchannelLogoutRegistry {
  protected readonly jwt = $inject(JwtProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly log = $logger();

  /**
   * The member of `events` that marks a logout token.
   */
  public static readonly EVENT =
    "http://schemas.openid.net/event/backchannel-logout";

  /**
   * The logout time, in seconds since the epoch, by `<provider>:sid:<sid>`
   * or `<provider>:sub:<sub>`. Thirty days: the session cookie's longest
   * life.
   */
  protected readonly loggedOut = $cache<number>({
    name: "alepha.server.auth.backchannel-logout",
    ttl: [30, "days"],
  });

  protected readonly verifiers = new Map<string, KeyLoaderHolder>();

  /**
   * Validate a logout token: its signature against the provider's keys,
   * `iss`, `aud` naming the client, `iat`, the logout event, a `sid` or a
   * `sub`, and no `nonce`. Answers what it ends, or `undefined` when it is
   * not a valid logout token.
   */
  public async verify(
    provider: AuthPrimitive,
    token: string,
  ): Promise<{ sid?: string; sub?: string } | undefined> {
    let verifier = this.verifiers.get(provider.name);
    if (!verifier) {
      verifier = this.jwt.createOidcKeyLoader(
        `backchannel-logout:${provider.name}`,
        () => provider,
        // `aud` must name the client: no `azp` stands in for it here.
        { clientId: provider.clientId, audience: provider.clientId },
      );
      this.verifiers.set(provider.name, verifier);
    }

    try {
      const { payload } = await this.jwt.verifyWith(verifier, token, {
        audience: provider.clientId,
        requiredClaims: ["iat"],
      });

      const events = payload.events as Record<string, unknown> | undefined;
      const event = events?.[BackchannelLogoutRegistry.EVENT];
      const sid = typeof payload.sid === "string" ? payload.sid : undefined;
      const sub = typeof payload.sub === "string" ? payload.sub : undefined;

      if (
        typeof event !== "object" ||
        event === null ||
        (!sid && !sub) ||
        "nonce" in payload
      ) {
        this.log.warn("Refused a malformed back-channel logout token", {
          provider: provider.name,
        });
        return undefined;
      }

      return { sid, sub };
    } catch (error) {
      this.log.warn("Refused a back-channel logout token", {
        provider: provider.name,
        error,
      });
      return undefined;
    }
  }

  /**
   * Record that the session named by `sid`, or every session of `sub`, ended
   * now.
   */
  public async record(
    provider: string,
    ended: { sid?: string; sub?: string },
  ): Promise<void> {
    const now = this.dateTime.now().unix();
    const key = ended.sid
      ? `${provider}:sid:${ended.sid}`
      : `${provider}:sub:${ended.sub}`;
    await this.loggedOut.set(key, now);
    this.log.info("Session ended by the identity provider", {
      provider,
      by: ended.sid ? "sid" : "sub",
    });
  }

  /**
   * Whether a session cookie's tokens were ended by a logout recorded since
   * they were issued. Its `sid` and `sub` are read from the id_token, else
   * the access token, without verifying them: the cookie is AES-GCM
   * authenticated, so its content is what this app wrote.
   *
   * A sign-in made after the logout has a later `issued_at` and passes,
   * which is what makes a logout by `sub` safe.
   */
  public async isLoggedOut(tokens: Tokens): Promise<boolean> {
    const claims = {
      ...this.decode(tokens.access_token),
      ...this.decode(tokens.id_token),
    };
    const keys: string[] = [];
    if (typeof claims.sid === "string") {
      keys.push(`${tokens.provider}:sid:${claims.sid}`);
    }
    if (typeof claims.sub === "string") {
      keys.push(`${tokens.provider}:sub:${claims.sub}`);
    }

    const issuedAt = tokens.issued_at ?? 0;
    for (const key of keys) {
      const at = await this.loggedOut.get(key);
      if (at !== undefined && issuedAt <= at) {
        return true;
      }
    }
    return false;
  }

  protected decode(token?: string): Record<string, unknown> {
    if (!token) {
      return {};
    }
    try {
      return JSON.parse(
        Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
      );
    } catch {
      return {};
    }
  }
}
