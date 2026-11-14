import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { $repository } from "alepha/orm";

import { type Host, hosts } from "../entities/hosts.ts";

/**
 * Issues and checks the secret a `bay` host dials in with.
 *
 * **A separate credential from anything a person holds**, for the same reason
 * `SigilTokenService` is: Lore's realm mints `api_keys` that carry the
 * holder's roles, and a host secret must be able to do exactly one thing,
 * which is open one websocket into one room. It lives on its own row, is
 * resolved by its own lookup, and is never a principal in the security realm.
 * That is what makes "the secret authenticates a machine, not its owner"
 * structural rather than a convention: `$websocket`'s `authorize` hook
 * (#1782) calls {@link verify} and returns a room, never a user.
 *
 * Two consumers besides the handshake: the host-facing HTTP routes that
 * hand a deploying machine its artifact bytes and secret set (#1844).
 */
export class HostTokenService {
  /**
   * What every host secret starts with, so one can be recognised in a log
   * or a paste without being mistaken for a sigil key (`sg_`) or an API key.
   *
   * Bay wire v1: `bay connector set` refuses a secret of any other shape
   * (`SecretPrefix` in `config.go`), so it keeps the `est_` of the word Lore
   * used before #E147.
   */
  public static readonly PREFIX = "est_";

  /**
   * How much of the secret {@link mint} keeps as `secretPrefix`: the marker
   * plus eight characters, enough to tell two hosts' secrets apart and far
   * too little to reconstruct one.
   */
  public static readonly PREFIX_LENGTH = HostTokenService.PREFIX.length + 8;

  protected readonly crypto = $inject(CryptoProvider);
  protected readonly hosts = $repository(hosts);

  /**
   * Mints a secret, returning the only cleartext copy that will ever exist.
   *
   * Stored hashed for the reason a password is: a database that leaks must
   * not be a fleet that leaks. The prefix is kept so the UI can name a
   * secret without being able to rebuild it.
   */
  async mint(): Promise<{ secret: string; hash: string; prefix: string }> {
    const secret = `${HostTokenService.PREFIX}${this.crypto.randomText(32)}`;
    return {
      secret,
      hash: await this.crypto.hash(secret),
      prefix: secret.slice(0, HostTokenService.PREFIX_LENGTH),
    };
  }

  /**
   * What an enrolment secret starts with (#Q3165): `bay connector set` reads
   * it to know it must exchange the secret before storing anything.
   */
  public static readonly ENROLMENT_PREFIX = "enr_";

  /**
   * How long an enrolment secret is accepted. Long enough for a server to
   * boot, install Docker and Bay and enrol (2.5 minutes on the prototype of
   * #Q3139), short enough that one read from user data a day later is dead.
   */
  public static readonly ENROLMENT_TTL_MILLIS = 30 * 60_000;

  /**
   * Mints an enrolment secret, returning its only cleartext copy.
   */
  async mintEnrolment(): Promise<{ secret: string; hash: string }> {
    const secret = `${HostTokenService.ENROLMENT_PREFIX}${this.crypto.randomText(32)}`;
    return { secret, hash: await this.crypto.hash(secret) };
  }

  /**
   * Resolves an enrolment secret to its host while it is still accepted:
   * the host has not connected with a long-lived secret since, and the
   * secret has not expired. `undefined` otherwise, for every case alike.
   */
  async verifyEnrolment(
    secret: string | undefined,
    nowMillis: number,
  ): Promise<Host | undefined> {
    if (!secret?.startsWith(HostTokenService.ENROLMENT_PREFIX)) {
      return undefined;
    }
    const host = await this.hosts.findOne({
      where: { enrolmentHash: { eq: await this.crypto.hash(secret) } },
    });
    if (!host?.enrolmentExpiresAt) {
      return undefined;
    }
    return Date.parse(host.enrolmentExpiresAt) > nowMillis ? host : undefined;
  }

  /**
   * Resolves a secret to the host it belongs to.
   *
   * `undefined` for a missing secret and an unknown one alike: telling a
   * caller which of the two it is would let anyone probe for secrets that
   * once existed. There is no revoked state to distinguish either. The
   * lookup is BY `secretHash`, so re-minting the hash is revocation: the old
   * secret stops resolving the instant the column changes, and a deleted
   * host resolves to nothing.
   */
  async verify(secret: string | undefined): Promise<Host | undefined> {
    if (!secret) {
      return undefined;
    }
    return await this.hosts.findOne({
      where: { secretHash: { eq: await this.crypto.hash(secret) } },
    });
  }

  /**
   * Reads the bearer out of an Authorization header.
   *
   * Anything that is not exactly `Bearer <secret>` yields `undefined` rather
   * than a best-effort parse: a header this service cannot read is a caller
   * it does not know.
   */
  bearer(header: string | undefined): string | undefined {
    if (!header?.startsWith("Bearer ")) {
      return undefined;
    }
    const secret = header.slice(7).trim();
    return secret || undefined;
  }
}
