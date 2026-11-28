import type {
  AnalyticsEventLog,
  EventLogQuery,
  EventLogResult,
  EventLogStoredRow,
} from "../schemas/eventLogSchema.ts";

/**
 * Where an event log's rows live.
 *
 * A seam of its own rather than more methods on `AnalyticsProvider`,
 * because the two never share a backend choice: a dataset may sit on
 * Analytics Engine, which samples, while an event log must always be exact.
 * An app bound to Analytics Engine therefore keeps its event logs on the
 * relational store.
 */
export abstract class EventLogProvider {
  /**
   * Declares a log before the container starts: a relational backend
   * registers its table, so `migrate()` creates it.
   */
  abstract register(log: AnalyticsEventLog): void;

  /**
   * Stores every row as given, `at` already placed and clamped.
   */
  abstract append(
    log: AnalyticsEventLog,
    rows: EventLogStoredRow[],
  ): Promise<void>;

  abstract query(
    log: AnalyticsEventLog,
    query: EventLogQuery,
  ): Promise<EventLogResult>;

  /**
   * Deletes at most `limit` rows whose `at` is before `before`, oldest
   * first, and answers how many it deleted. The hourly sweep calls it with
   * a cap and resumes on the next run, so a backlog never runs one call
   * past its timeout.
   */
  abstract prune(
    log: AnalyticsEventLog,
    before: number,
    limit: number,
  ): Promise<number>;
}
