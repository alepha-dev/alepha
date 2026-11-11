import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import type { Page } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import { UserAudits } from "../audits/UserAudits.ts";
import type { IdentityEntity } from "../entities/identities.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";
import type { IdentityQuery } from "../schemas/identityQuerySchema.ts";
import { PasskeyService } from "./PasskeyService.ts";

export class IdentityService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly realmProvider = $inject(RealmProvider);
  protected readonly passkeyService = $inject(PasskeyService);

  protected userAudits(realmName?: string) {
    // Registered by every `$realm` whatever its features say; a realm
    // registered straight through `RealmProvider` (tests) may not have it.
    if (this.alepha.has(UserAudits)) {
      return this.alepha.inject(UserAudits);
    }
    return undefined;
  }

  public identities(userRealmName?: string) {
    return this.realmProvider.identityRepository(userRealmName);
  }

  /**
   * Find identities with pagination and filtering.
   */
  public async findIdentities(
    q: IdentityQuery = {},
    userRealmName?: string,
  ): Promise<Page<IdentityEntity>> {
    this.log.trace("Finding identities", { query: q, userRealmName });
    q.sort ??= "-createdAt";

    const where = this.identities(userRealmName).createQueryWhere();

    if (q.userId) {
      where.userId = { eq: q.userId };
    }

    if (q.provider) {
      where.provider = { like: q.provider };
    }

    // Identities carry no realm column: a listing filtered on a user of
    // another realm must come back empty rather than leak that user's
    // providers.
    if (q.userId) {
      const realm = this.realmProvider.getRealm(userRealmName);
      const owner = await this.realmProvider
        .userRepository(userRealmName)
        .findOne({
          where: { id: { eq: q.userId }, realm: { eq: realm.name } },
        });
      if (!owner) {
        where.userId = { eq: "00000000-0000-0000-0000-000000000000" };
      }
    }

    const result = await this.identities(userRealmName).paginate(
      q,
      { where },
      { count: true },
    );

    this.log.debug("Identities found", {
      count: result.content.length,
      total: result.page.totalElements,
    });

    return result;
  }

  /**
   * Get an identity by ID.
   */
  public async getIdentityById(
    id: string,
    userRealmName?: string,
  ): Promise<IdentityEntity> {
    this.log.trace("Getting identity by ID", { id, userRealmName });
    const identity = await this.identities(userRealmName).getById(id);
    // Identities carry no realm column; the owner's realm decides.
    const realm = this.realmProvider.getRealm(userRealmName);
    const owner = await this.realmProvider
      .userRepository(userRealmName)
      .findOne({
        where: { id: { eq: identity.userId }, realm: { eq: realm.name } },
      });
    if (!owner) {
      throw new NotFoundError(`Identity '${id}' not found`);
    }
    this.log.debug("Identity retrieved", {
      id,
      provider: identity.provider,
      userId: identity.userId,
    });
    return identity;
  }

  /**
   * An identity as an admin response carries it. A passkey row goes out
   * without its public key: nothing secret, but nothing an operator needs
   * either. The credential id stays in `providerUserId`: it is the row's key,
   * and the server hands it out in `excludeCredentials` anyway.
   */
  public toResource(identity: IdentityEntity): IdentityEntity {
    if (identity.provider !== this.passkeyService.provider) {
      return identity;
    }
    const { publicKey: _publicKey, ...data } = (identity.providerData ??
      {}) as Record<string, unknown>;
    return { ...identity, providerData: data };
  }

  /**
   * Revoke every passkey of a user, for the support case of a lost phone.
   * Each is audited as `passkey_remove` and notified. The user's current
   * sessions stay: revoking them is its own action.
   */
  public async revokeAllPasskeys(
    userId: string,
    userRealmName?: string,
    actor?: { id: string; email?: string },
  ): Promise<number> {
    const realm = this.realmProvider.getRealm(userRealmName);
    const owner = await this.realmProvider
      .userRepository(userRealmName)
      .findOne({ where: { id: { eq: userId }, realm: { eq: realm.name } } });
    if (!owner) {
      throw new NotFoundError(`User '${userId}' not found`);
    }
    const rows = await this.passkeyService.passkeysOf(userId, userRealmName);
    for (const row of rows) {
      await this.passkeyService.revoke(row, userRealmName, actor);
    }
    return rows.length;
  }

  /**
   * Delete an identity by ID. A passkey row is revoked through
   * `PasskeyService.revoke`: audited as `passkey_remove` and notified to
   * its owner, as a removal from the account page is. No "last way to sign
   * in" guard, as for every identity an administrator removes.
   */
  public async deleteIdentity(
    id: string,
    userRealmName?: string,
    actor?: { id: string; email?: string },
  ): Promise<void> {
    this.log.trace("Deleting identity", { id, userRealmName });

    // Verify identity exists
    const identity = await this.getIdentityById(id, userRealmName);

    if (identity.provider === this.passkeyService.provider) {
      await this.passkeyService.revoke(identity, userRealmName, actor);
      return;
    }

    await this.identities(userRealmName).deleteById(id);
    this.log.info("Identity deleted", {
      id,
      provider: identity.provider,
      userId: identity.userId,
    });

    const realm = this.realmProvider.getRealm(userRealmName);

    await this.userAudits(userRealmName)?.user.log("update", {
      resourceType: "user",
      userRealm: realm.name,
      resourceId: identity.userId,
      description: `Identity provider disconnected: ${identity.provider}`,
      metadata: {
        identityId: id,
        provider: identity.provider,
        userId: identity.userId,
      },
    });
  }
}
