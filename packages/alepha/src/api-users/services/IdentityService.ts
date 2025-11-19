import { $inject } from "alepha";
import type { Page } from "alepha/orm";
import type { IdentityEntity } from "../entities/identities.ts";
import { UserRealmProvider } from "../providers/UserRealmProvider.ts";
import type { IdentityQuery } from "../schemas/identityQuerySchema.ts";

export class IdentityService {
  protected readonly userRealmProvider = $inject(UserRealmProvider);

  public identities(userRealmName?: string) {
    return this.userRealmProvider.identityRepository(userRealmName);
  }

  /**
   * Find identities with pagination and filtering.
   */
  public async findIdentities(
    q: IdentityQuery = {},
    userRealmName?: string,
  ): Promise<Page<IdentityEntity>> {
    q.sort ??= "-createdAt";

    const where = this.identities(userRealmName).createQueryWhere();

    if (q.userId) {
      where.userId = { eq: q.userId };
    }

    if (q.provider) {
      where.provider = { like: q.provider };
    }

    return await this.identities(userRealmName).paginate(
      q,
      { where },
      { count: true },
    );
  }

  /**
   * Get an identity by ID.
   */
  public async getIdentityById(
    id: string,
    userRealmName?: string,
  ): Promise<IdentityEntity> {
    return await this.identities(userRealmName).findById(id);
  }

  /**
   * Delete an identity by ID.
   */
  public async deleteIdentity(
    id: string,
    userRealmName?: string,
  ): Promise<void> {
    // Verify identity exists
    await this.getIdentityById(id, userRealmName);

    await this.identities(userRealmName).deleteById(id);
  }
}
