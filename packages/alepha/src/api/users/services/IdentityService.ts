import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import type { Page } from "alepha/orm";
import { UserAudits } from "../audits/UserAudits.ts";
import type { IdentityEntity } from "../entities/identities.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";
import type { IdentityQuery } from "../schemas/identityQuerySchema.ts";

export class IdentityService {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly realmProvider = $inject(RealmProvider);

  protected userAudits(realmName?: string) {
    const realm = this.realmProvider.getRealm(realmName);
    if (realm.features.audits) {
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
    this.log.debug("Identity retrieved", {
      id,
      provider: identity.provider,
      userId: identity.userId,
    });
    return identity;
  }

  /**
   * Delete an identity by ID.
   */
  public async deleteIdentity(
    id: string,
    userRealmName?: string,
  ): Promise<void> {
    this.log.trace("Deleting identity", { id, userRealmName });

    // Verify identity exists
    const identity = await this.getIdentityById(id, userRealmName);

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
