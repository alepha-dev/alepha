import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { sessions } from "../entities/sessions.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";

/**
 * User-specific jobs wrapper service.
 *
 * This service handles user-related scheduled jobs such as:
 * - Session purge (cleaning up expired sessions)
 * - Verification code cleanup
 * - Inactive user notifications
 *
 * Declared as a module variant — not auto-injected. It is instantiated
 * lazily the first time something calls `alepha.inject(UserJobs)`.
 */
export class UserJobs {
  protected readonly log = $logger();
  protected readonly dateTimeProvider = $inject(DateTimeProvider);
  protected readonly sessionRepository = $repository(sessions);
  protected readonly realmProvider = $inject(RealmProvider);

  /**
   * Purge expired sessions from the database.
   *
   * Runs hourly (at :00) and deletes:
   * - sessions whose absolute `expiresAt` has passed
   * - sessions whose `lastUsedAt` exceeds the realm's `refreshToken.expirationIdle`
   *   (when configured). Falls back to `createdAt` for sessions without a
   *   recorded `lastUsedAt`.
   *
   * The idle sweep is best-effort cleanup — runtime enforcement happens in
   * `SessionService.refreshSession()`.
   */
  public readonly purgeExpiredSessions = $job({
    name: "api:users:purgeExpiredSessions",
    cron: "0 * * * *", // Hourly at minute 0
    handler: async () => {
      const now = this.dateTimeProvider.nowISOString();

      this.log.info("Starting expired sessions purge", { cutoffTime: now });

      const absoluteDeletedIds = await this.sessionRepository.deleteMany({
        expiresAt: { lt: now },
      });

      if (absoluteDeletedIds.length > 0) {
        this.log.info("Expired sessions purged (absolute)", {
          deletedCount: absoluteDeletedIds.length,
        });
      }

      // Idle sweep — only if the default realm has expirationIdle configured.
      // Multi-realm setups with per-realm session tables should add their own
      // job; this default job sweeps the default sessions table.
      const realm = this.realmProvider.getRealm();
      const settings = await realm.getSettings();
      const idleMs = settings.refreshToken?.expirationIdle;
      if (idleMs && idleMs > 0) {
        const cutoff = this.dateTimeProvider
          .now()
          .subtract(idleMs, "milliseconds")
          .toISOString();

        // Two passes: rows with an explicit lastUsedAt, and pre-migration rows
        // where lastUsedAt is null — those fall back to createdAt.
        const lastUsedDeletedIds = await this.sessionRepository.deleteMany({
          lastUsedAt: { lt: cutoff },
        });
        const fallbackDeletedIds = await this.sessionRepository.deleteMany({
          lastUsedAt: { isNull: true },
          createdAt: { lt: cutoff },
        });

        const idleTotal = lastUsedDeletedIds.length + fallbackDeletedIds.length;
        if (idleTotal > 0) {
          this.log.info("Expired sessions purged (idle)", {
            deletedCount: idleTotal,
            thresholdMs: idleMs,
          });
        }
      }
    },
  });
}
