import { sigilKeyBuild, sigilKeyPrefix } from "@alepha/lore/sigil";
import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { $repository } from "alepha/orm";

import { projects } from "../entities/projects.ts";
import { type Sigil, sigils } from "../entities/sigils.ts";

/**
 * Issues and checks the tokens apps report with.
 *
 * **A separate credential from anything a human holds.** Lore's realm also
 * mints `api_keys`, and those carry the operator's roles — a key created there
 * can read every project the holder belongs to and write quests into them. A
 * sigil token must be able to do exactly one thing, so it lives on its own row
 * and is resolved by its own lookup; the two are never interchangeable in
 * either direction.
 *
 * That separation is enforced here rather than by convention, because the
 * tempting shortcut — reusing `api_keys` because it already exists — turns a
 * leaked sigil token, of which there is one per enrolled app on every
 * machine that runs it, into a project credential.
 */
export class SigilTokenService {
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly sigils = $repository(sigils);
  protected readonly projects = $repository(projects);

  /**
   * Mints a token, returning the only cleartext copy that will ever exist.
   *
   * Stored hashed for the same reason a password is: a database that leaks
   * should not be a fleet that leaks. The prefix is kept so the UI can name a
   * token without being able to reconstruct it.
   *
   * **The project slug rides in the token**, so an enrolled app can address its
   * own project without asking. It is not a second credential and protects
   * nothing: the slug is already printed into the feedback link on every page
   * the app renders. What it buys is that the app no longer has to be TOLD its
   * own project in a second variable that could disagree with this one.
   *
   * A project with no slug mints the older shape, with no namespace. Every live
   * row has one and every write path sets it, so this is the theoretical case
   * rather than the expected one - and a key with no slug is a working
   * credential that merely offers no feedback link, which beats baking a
   * guessed slug into a URL readers will follow.
   */
  async mint(
    projectId: number,
  ): Promise<{ token: string; hash: string; prefix: string }> {
    const project = await this.projects.findOne({
      where: { id: { eq: projectId } },
    });
    const secret = this.crypto.randomText(32);
    const token = project?.slug
      ? sigilKeyBuild(project.slug, secret)
      : `sg_${secret}`;
    return {
      token,
      hash: this.crypto.hash(token),
      prefix: sigilKeyPrefix(token),
    };
  }

  /**
   * Resolves a bearer token to the sigil it belongs to.
   *
   * Returns `undefined` for a missing token and an unknown one alike: telling a
   * caller which of the two it is would let anyone probe for tokens that once
   * existed. There is no revoked state to distinguish either — the lookup is
   * *by* `tokenHash`, so re-minting the hash is revocation: `rotateSigil` is
   * what an operator reaches for, and the old token stops resolving the instant
   * the column changes, with the app's history left intact. Deleting
   * the sigil also revokes, but it cascades the aggregates away with it.
   */
  async verify(token: string | undefined): Promise<Sigil | undefined> {
    if (!token) {
      return undefined;
    }
    return await this.sigils.findOne({
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
