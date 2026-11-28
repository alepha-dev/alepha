import { SIGIL_VISITOR_PERIOD_GRACE_MS } from "@alepha/lore/sigil";
import { $inject, z } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, DatabaseProvider, sql } from "alepha/orm";

import { sigilSessions } from "../entities/sigilSessions.ts";
import { sigilVisits } from "../entities/sigilVisits.ts";

/**
 * Keeps sessions and visits from outliving what they may say.
 *
 * Views and vitals live in the `sigil_views` / `sigil_vitals` `$analytics()`
 * datasets, and the page view log is an event log: their retention is
 * `AnalyticsRollupJobs`' (`alepha/api/analytics`). Sessions and visits are
 * Lore's own tables, so their upkeep is here.
 *
 * The hash expiry is privacy maintenance, not storage maintenance: it is
 * what makes a visitor hash stop existing once its period has ended, so no
 * identifier outlives its period. The 400 day prune bounds the tables.
 *
 * Every step is one bounded statement binding one or two values, so D1's 100
 * bound parameters never come into it, and it behaves alike on SQLite,
 * Postgres and D1.
 */
export class SigilJobs {
  /**
   * Milliseconds in a day, for the cutoff arithmetic.
   */
  protected readonly DAY_MS = 24 * 60 * 60 * 1000;

  /**
   * How long sessions and visits are kept.
   */
  protected readonly VISITS_KEEP_DAYS = 400;

  /**
   * Most rows one sweep touches per statement, so a backlog is worked off
   * over several hours rather than in one statement past the job's timeout.
   */
  public static MAX_VISITOR_ROWS_PER_SWEEP = 5_000;

  protected readonly log = $logger();
  protected readonly sessions = $repository(sigilSessions);
  protected readonly visits = $repository(sigilVisits);
  protected readonly database = $inject(DatabaseProvider);
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * Erases each visitor hash once its period has ended, then prunes sessions
   * and visits past 400 days.
   *
   * On the shared `0 * * * *` slot, beside the other hourly jobs
   * (`ProjectErrorJobs`, `HourlyJobs`, `EpicJobs`, `RequirementMetricJobs`),
   * so it costs no Cloudflare cron trigger of its own.
   */
  public readonly expireVisitors = $job({
    name: "sigils.expire-visitors",
    description:
      "Erases visitor hashes whose period has ended, and prunes sessions and visits older than 400 days.",
    cron: "0 * * * *",
    timeout: [2, "minutes"],
    handler: async () => {
      await this.expireVisitorsNow();
    },
  });

  /**
   * One sweep of {@link expireVisitors}; public so specs run it under a
   * paused clock. Answers what each step touched.
   */
  public async expireVisitorsNow(at = this.dt.nowMillis()): Promise<{
    erased: number;
    visits: number;
    sessions: number;
  }> {
    // Past the grace a late batch may still name the period in, so a batch
    // never finds its session's hash already gone.
    const ended = new Date(at - SIGIL_VISITOR_PERIOD_GRACE_MS).toISOString();
    const cutoff = new Date(
      at - this.VISITS_KEEP_DAYS * this.DAY_MS,
    ).toISOString();
    const limit = sql.raw(String(SigilJobs.MAX_VISITOR_ROWS_PER_SWEEP));
    const s = this.sessions.table;
    const v = this.visits.table;
    const touched = z.object({ id: z.string() });

    const erased = await this.database.run(
      sql`UPDATE ${s} SET ${sql.raw(`"${s.visitorHash.name}"`)} = NULL WHERE ${s.id} IN (SELECT ${s.id} FROM ${s} WHERE ${s.visitorHash} IS NOT NULL AND ${s.periodEndsAt} <= ${ended} LIMIT ${limit}) RETURNING ${s.id} AS id`,
      touched,
    );
    // Visits before sessions: a session's last event is at least its
    // visits', so the visits of an expiring session are expired too, and the
    // session's own cascade has nothing left to delete unbounded.
    const visits = await this.database.run(
      sql`DELETE FROM ${v} WHERE ${v.id} IN (SELECT ${v.id} FROM ${v} WHERE ${v.lastSeenAt} < ${cutoff} LIMIT ${limit}) RETURNING ${v.id} AS id`,
      touched,
    );
    const sessions = await this.database.run(
      sql`DELETE FROM ${s} WHERE ${s.id} IN (SELECT ${s.id} FROM ${s} WHERE ${s.lastSeenAt} < ${cutoff} LIMIT ${limit}) RETURNING ${s.id} AS id`,
      touched,
    );

    const result = {
      erased: erased.length,
      visits: visits.length,
      sessions: sessions.length,
    };
    if (result.erased + result.visits + result.sessions > 0) {
      this.log.info("Expired visitor hashes and pruned old visits", result);
    }
    return result;
  }
}
