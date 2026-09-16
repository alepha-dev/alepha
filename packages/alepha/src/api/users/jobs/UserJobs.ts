import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, type PgQueryWhere } from "alepha/orm";

import { sessions } from "../entities/sessions.ts";
import { RealmProvider } from "../providers/RealmProvider.ts";

/**
 * User-specific jobs wrapper service.
 *
 * This service handles user-related scheduled jobs:
 * - Session purge (cleaning up expired sessions)
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
   * Most batches one sweep deletes per run.
   *
   * A cap, not a drain: the purge used to run only where an application
   * opted in, so on the first run anywhere else it meets every session row
   * since launch. Deleting all of them in one tick is the largest write the
   * job will ever make, and on Cloudflare D1's free plan a query past the
   * daily row-write limit fails until midnight UTC, taking the application
   * down with it. Ten batches is 900 rows a tick on D1 and 10,000 elsewhere;
   * the next tick takes the rest.
   */
  protected readonly maxBatchesPerRun = 10;

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
    name: "system.users.purge-expired-sessions",
    description:
      "Deletes sessions past their expiry date, and sessions idle for longer than the realm allows.",
    cron: "0 * * * *", // Hourly at minute 0
    handler: async () => {
      const now = this.dateTimeProvider.nowISOString();

      this.log.info("Starting expired sessions purge", { cutoffTime: now });

      const absoluteDeleted = await this.purgeInBatches({
        expiresAt: { lt: now },
      });

      if (absoluteDeleted > 0) {
        this.log.info("Expired sessions purged (absolute)", {
          deletedCount: absoluteDeleted,
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
        // where lastUsedAt is null — those fall back to createdAt. Each is
        // bounded on its own.
        const lastUsedDeleted = await this.purgeInBatches({
          lastUsedAt: { lt: cutoff },
        });
        const fallbackDeleted = await this.purgeInBatches({
          lastUsedAt: { isNull: true },
          createdAt: { lt: cutoff },
        });

        const idleTotal = lastUsedDeleted + fallbackDeleted;
        if (idleTotal > 0) {
          this.log.info("Expired sessions purged (idle)", {
            deletedCount: idleTotal,
            thresholdMs: idleMs,
          });
        }
      }
    },
  });

  /**
   * Rows one batch selects and deletes: 1000, or fewer when the driver binds
   * fewer parameters per statement. The delete binds one parameter per id,
   * so on D1 (a ceiling of 100) it is 90, the number `BlightJobs` uses in
   * Lore, with room left for the rest of the statement.
   */
  protected batchSize(): number {
    return Math.min(
      1000,
      this.sessionRepository.provider.maxBoundParameters - 10,
    );
  }

  /**
   * Delete the sessions matching `where`, oldest first, in bounded batches:
   * select a batch of ids, delete by id, and stop at a short batch (the end of
   * the backlog) or at {@link maxBatchesPerRun}. Returns how many went.
   *
   * Two statements per batch because `deleteMany` takes no limit and
   * PostgreSQL has no `DELETE ... LIMIT`.
   */
  protected async purgeInBatches(
    where: PgQueryWhere<typeof sessions.schema>,
  ): Promise<number> {
    const size = this.batchSize();
    let deleted = 0;

    for (let batch = 0; batch < this.maxBatchesPerRun; batch++) {
      const rows = await this.sessionRepository.findMany({
        where,
        columns: ["id"],
        limit: size,
        orderBy: { column: "createdAt", direction: "asc" },
      });
      if (rows.length === 0) {
        break;
      }

      await this.sessionRepository.deleteMany({
        id: { inArray: rows.map((row) => row.id) },
      });
      deleted += rows.length;

      if (rows.length < size) {
        break;
      }
    }

    return deleted;
  }
}
