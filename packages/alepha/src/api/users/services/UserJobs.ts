import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { sessions } from "../entities/sessions.ts";

/**
 * User-specific jobs wrapper service.
 *
 * This service handles user-related scheduled jobs such as:
 * - Session purge (cleaning up expired sessions)
 * - Verification code cleanup
 * - Inactive user notifications
 *
 * It is lazy-loaded when the `jobs` feature is enabled in the realm.
 */
export class UserJobs {
  protected readonly log = $logger();
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly sessionRepository = $repository(sessions);

  /**
   * Purge expired sessions from the database.
   *
   * This job runs daily at 3:00 AM and removes all sessions
   * where the `expiresAt` timestamp has passed.
   */
  public readonly purgeExpiredSessions = $job({
    name: "users.purgeExpiredSessions",
    description: "Remove expired user sessions from the database",
    cron: "0 3 * * *", // Daily at 3:00 AM
    handler: async () => {
      const now = this.dateTimeProvider.nowISOString();

      this.log.info("Starting expired sessions purge", { cutoffTime: now });

      const expiredSessions = await this.sessionRepository.findMany({
        where: {
          expiresAt: { lt: now },
        },
      });

      if (expiredSessions.length === 0) {
        this.log.info("No expired sessions found");
        return;
      }

      this.log.info("Found expired sessions", {
        count: expiredSessions.length,
      });

      const deletedIds = await this.sessionRepository.deleteMany({
        expiresAt: { lt: now },
      });

      this.log.info("Expired sessions purged successfully", {
        deletedCount: deletedIds.length,
      });
    },
  });
}
