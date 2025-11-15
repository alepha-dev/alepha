import { $repository, type Page } from "@alepha/orm";
import type { SessionEntity } from "../entities/sessions.ts";
import { sessions } from "../entities/sessions.ts";
import type { SessionQuery } from "../schemas/sessionQuerySchema.ts";

export class SessionCrudService {
  public readonly sessions = $repository(sessions);

  /**
   * Find sessions with pagination and filtering.
   */
  public async findSessions(
    q: SessionQuery = {},
  ): Promise<Page<SessionEntity>> {
    q.sort ??= "-createdAt";

    const where = this.sessions.createQueryWhere();

    if (q.userId) {
      where.userId = { eq: q.userId };
    }

    return await this.sessions.paginate(q, { where }, { count: true });
  }

  /**
   * Get a session by ID.
   */
  public async getSessionById(id: string): Promise<SessionEntity> {
    return await this.sessions.findById(id);
  }

  /**
   * Delete a session by ID.
   */
  public async deleteSession(id: string): Promise<void> {
    // Verify session exists
    await this.getSessionById(id);

    await this.sessions.deleteById(id);
  }
}
