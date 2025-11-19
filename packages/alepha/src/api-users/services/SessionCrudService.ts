import { $inject } from "alepha";
import type { Page } from "alepha/orm";
import type { SessionEntity } from "../entities/sessions.ts";
import { UserRealmProvider } from "../providers/UserRealmProvider.ts";
import type { SessionQuery } from "../schemas/sessionQuerySchema.ts";

export class SessionCrudService {
  protected readonly userRealmProvider = $inject(UserRealmProvider);

  public sessions(userRealmName?: string) {
    return this.userRealmProvider.sessionRepository(userRealmName);
  }

  /**
   * Find sessions with pagination and filtering.
   */
  public async findSessions(
    q: SessionQuery = {},
    userRealmName?: string,
  ): Promise<Page<SessionEntity>> {
    q.sort ??= "-createdAt";

    const where = this.sessions(userRealmName).createQueryWhere();

    if (q.userId) {
      where.userId = { eq: q.userId };
    }

    return await this.sessions(userRealmName).paginate(q, { where }, { count: true });
  }

  /**
   * Get a session by ID.
   */
  public async getSessionById(id: string, userRealmName?: string): Promise<SessionEntity> {
    return await this.sessions(userRealmName).findById(id);
  }

  /**
   * Delete a session by ID.
   */
  public async deleteSession(id: string, userRealmName?: string): Promise<void> {
    // Verify session exists
    await this.getSessionById(id, userRealmName);

    await this.sessions(userRealmName).deleteById(id);
  }
}
