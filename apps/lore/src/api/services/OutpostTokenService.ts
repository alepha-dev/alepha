import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { $repository } from "alepha/orm";
import { type Outpost, outposts } from "../entities/outposts.ts";

/**
 * Issues and checks the tokens machines report with.
 *
 * A third credential, deliberately separate from both the realm's `api_keys`
 * and from sigil tokens. The reasoning is the same one that kept sigils off
 * `api_keys`, applied once more: a token that sits in cleartext on a host must
 * be able to do exactly one thing, and the only way to guarantee that is to
 * resolve it by its own lookup against its own table.
 *
 * What an outpost token can do is narrower still than a sigil's: it writes the
 * state of a machine into one campaign. It cannot read a campaign, cannot touch
 * a quest, and — this is the part that made the push model worth choosing — it
 * grants **nothing at all on the machine it came from**. Someone who steals it
 * can lie to Lore about a fleet. They cannot deploy, read a secret, or open a
 * database.
 */
export class OutpostTokenService {
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly outposts = $repository(outposts);

  /**
   * Mints a token, returning the only cleartext copy that will ever exist.
   *
   * `op_` rather than `sg_` so the two are never confused in a log, a `.env` or
   * a support conversation — they authorise different things and are pasted in
   * different places.
   */
  mint(): { token: string; hash: string; prefix: string } {
    const token = `op_${this.crypto.randomText(32)}`;
    return {
      token,
      hash: this.crypto.hash(token),
      prefix: token.slice(0, 11),
    };
  }

  /**
   * Resolves a bearer token to the outpost it belongs to.
   *
   * Returns `undefined` for missing and unknown alike: distinguishing them
   * would let anyone with the URL probe for tokens that once existed.
   *
   * There is no revoked flag, for the same reason a sigil has none — the lookup
   * is *by* `tokenHash`, so re-minting it revokes instantly. Rotation is
   * therefore the revocation path, and it keeps the machine's history: deleting
   * the outpost also revokes, but it cascades away every app row and every
   * deploy event with it, which is exactly the timeline you wanted.
   */
  async verify(token: string | undefined): Promise<Outpost | undefined> {
    if (!token) {
      return undefined;
    }
    return await this.outposts.findOne({
      where: { tokenHash: { eq: this.crypto.hash(token) } },
    });
  }

  /**
   * Reads the bearer out of an Authorization header.
   *
   * Anything that is not exactly `Bearer <token>` yields `undefined` rather
   * than a best-effort parse: a header this service cannot read is a caller it
   * does not know.
   */
  bearer(header: string | undefined): string | undefined {
    if (!header?.startsWith("Bearer ")) {
      return undefined;
    }
    const token = header.slice(7).trim();
    return token || undefined;
  }
}
