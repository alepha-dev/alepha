import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { $repository } from "alepha/orm";

import { type Estate, estates } from "../entities/estates.ts";

/**
 * Issues and checks the secret a `bay` estate dials in with.
 *
 * **A separate credential from anything a person holds**, for the same reason
 * `SigilTokenService` is: Lore's realm mints `api_keys` that carry the
 * holder's roles, and an estate secret must be able to do exactly one thing,
 * which is open one websocket into one room. It lives on its own row, is
 * resolved by its own lookup, and is never a principal in the security realm.
 * That is what makes "the secret authenticates a machine, not its owner"
 * structural rather than a convention: `$websocket`'s `authorize` hook
 * (#1782) calls {@link verify} and returns a room, never a user.
 *
 * Two consumers besides the handshake: the estate-facing HTTP routes that
 * hand a deploying machine its artifact bytes and secret set (#1844).
 */
export class EstateTokenService {
  /**
   * What every estate secret starts with, so one can be recognised in a log
   * or a paste without being mistaken for a sigil key (`sg_`) or an API key.
   */
  public static readonly PREFIX = "est_";

  /**
   * How much of the secret {@link mint} keeps as `secretPrefix`: the marker
   * plus eight characters, enough to tell two estates' secrets apart and far
   * too little to reconstruct one.
   */
  public static readonly PREFIX_LENGTH = EstateTokenService.PREFIX.length + 8;

  protected readonly crypto = $inject(CryptoProvider);
  protected readonly estates = $repository(estates);

  /**
   * Mints a secret, returning the only cleartext copy that will ever exist.
   *
   * Stored hashed for the reason a password is: a database that leaks must
   * not be a fleet that leaks. The prefix is kept so the UI can name a
   * secret without being able to rebuild it.
   */
  mint(): { secret: string; hash: string; prefix: string } {
    const secret = `${EstateTokenService.PREFIX}${this.crypto.randomText(32)}`;
    return {
      secret,
      hash: this.crypto.hash(secret),
      prefix: secret.slice(0, EstateTokenService.PREFIX_LENGTH),
    };
  }

  /**
   * Resolves a secret to the estate it belongs to.
   *
   * `undefined` for a missing secret and an unknown one alike: telling a
   * caller which of the two it is would let anyone probe for secrets that
   * once existed. There is no revoked state to distinguish either. The
   * lookup is BY `secretHash`, so re-minting the hash is revocation: the old
   * secret stops resolving the instant the column changes, and a deleted
   * estate resolves to nothing.
   */
  async verify(secret: string | undefined): Promise<Estate | undefined> {
    if (!secret) {
      return undefined;
    }
    return await this.estates.findOne({
      where: { secretHash: { eq: this.crypto.hash(secret) } },
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
