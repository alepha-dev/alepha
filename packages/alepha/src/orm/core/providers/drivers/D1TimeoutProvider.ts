import { $inject } from "alepha";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import { $logger } from "alepha/logger";

import { DbTimeoutError } from "../../errors/DbTimeoutError.ts";
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from "../../interfaces/D1Database.ts";

export interface D1TimeoutOptions {
  /**
   * Which statements the budget governs.
   *
   * `all` (the default) is what actually fixes a stalled primary, because a
   * stalled write hangs a request exactly as hard as a stalled read: in the
   * 2026-08-21 incident the single longest wait was a POST.
   *
   * `reads` is the escape hatch. D1 offers no way to abort a statement, so a
   * write that loses the race may still commit while its caller is told it
   * failed. An app where a phantom insert is worse than a slow page (money
   * moving, say) chooses `reads` and keeps writes unbounded.
   */
  applyTo?: "all" | "reads";
}

/**
 * Puts a ceiling on how long a D1 call may take.
 *
 * D1 is a single primary with no replica by default, so a stall there queues
 * every query behind it. Without a ceiling that stall is absorbed as
 * unbounded latency: on 2026-08-21 a blip on `lore.alepha.dev` held requests
 * for 32 seconds and handed the whole delay to the browser. A budget converts
 * that into a fast 503 the caller can act on.
 *
 * The binding is wrapped rather than the call sites: `drizzle-orm/d1` only
 * ever calls `prepare()` and `batch()` on it, so wrapping the binding covers
 * every query the app can issue, drizzle-generated SQL and raw `execute()`
 * alike, without touching the twenty-odd places `Repository` resolves a `db`.
 */
export class D1TimeoutProvider {
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly log = $logger();

  /**
   * Returns a binding that behaves exactly like the one given, except that
   * every statement it produces gives up after `budget`.
   */
  public wrap(
    db: D1Database,
    budget: DurationLike,
    options: D1TimeoutOptions = {},
  ): D1Database {
    const wrapped: D1Database = {
      ...this.wrapQueries(db, budget, options),
      // `exec` and `dump` stay unbounded on purpose. Neither is on the
      // request path: `exec` runs schema statements (a migration legitimately
      // takes longer than a request budget) and `dump` snapshots the whole
      // database. Capping them would turn a slow migration into a corrupt
      // half-applied one.
      exec: (query) => db.exec(query),
      dump: () => db.dump(),
    };

    // Only when the runtime actually has it. Defining it unconditionally
    // would defeat the feature check callers use to decide whether read
    // replication is available, and inventing a session on a `workerd` build
    // that has none would fail at the first query instead of at the check.
    if (db.withSession) {
      const open = db.withSession.bind(db);
      wrapped.withSession = (constraintOrBookmark) => {
        const session = open(constraintOrBookmark);
        return {
          ...this.wrapQueries(session, budget, options),
          getBookmark: () => session.getBookmark(),
        };
      };
    }

    return wrapped;
  }

  /**
   * The half of the binding a session also has.
   *
   * Shared so a sessions-mode app keeps the same ceiling as a primary-mode
   * one. The budget defaults to on for serverless, so a session that escaped
   * this would silently reintroduce the unbounded stall for exactly the apps
   * that opted into replication.
   */
  protected wrapQueries(
    source: Pick<D1Database, "prepare" | "batch">,
    budget: DurationLike,
    options: D1TimeoutOptions,
  ): Pick<D1Database, "prepare" | "batch"> {
    const readsOnly = options.applyTo === "reads";

    return {
      prepare: (query: string) => {
        const statement = source.prepare(query);
        if (readsOnly && !this.isRead(query)) {
          return statement;
        }
        return this.wrapStatement(statement, query, budget);
      },
      batch: <T>(statements: D1PreparedStatement[]) => {
        // `batch` is D1's atomic multi-statement API and carries no SQL we
        // could classify, so under `reads` it counts as a write and stays
        // unbounded. Guessing the other way would silently bound the one
        // call an app picked `reads` to protect.
        if (readsOnly) {
          return source.batch<T>(statements);
        }
        return this.race<T[]>(
          () => source.batch<T>(statements),
          budget,
          `batch of ${statements.length} statement(s)`,
        );
      },
    };
  }

  protected wrapStatement(
    statement: D1PreparedStatement,
    query: string,
    budget: DurationLike,
  ): D1PreparedStatement {
    const wrapped: D1PreparedStatement = {
      // `bind` returns a NEW statement carrying the bound values; returning
      // `wrapped` here instead would drop them, so re-wrap what D1 hands back.
      bind: (...values: unknown[]) =>
        this.wrapStatement(statement.bind(...values), query, budget),
      first: <T>(colName?: string) =>
        this.race<T | null>(() => statement.first<T>(colName), budget, query),
      run: () => this.race<D1Result>(() => statement.run(), budget, query),
      all: <T>() =>
        this.race<D1Result<T>>(() => statement.all<T>(), budget, query),
      raw: <T>() => this.race<T[]>(() => statement.raw<T>(), budget, query),
    };

    return wrapped;
  }

  /**
   * Races the call against the budget.
   *
   * The timer comes from `DateTimeProvider` rather than a bare `setTimeout`
   * for two reasons: it is what makes the budget exercisable with `travel()`
   * instead of a test that really sleeps, and Workers freezes `Date.now()`
   * between I/O, so any implementation that compared timestamps would never
   * fire during the very stall it exists to catch.
   */
  protected race<T>(
    call: () => Promise<T>,
    budget: DurationLike,
    query: string,
  ): Promise<T> {
    let timedOut = false;
    let trip: (error: Error) => void = () => {};

    const tripped = new Promise<never>((_, reject) => {
      trip = reject;
    });

    const timer = this.dateTime.createTimeout(() => {
      timedOut = true;
      this.log.error("D1 query timed out", {
        query: this.summarize(query),
      });
      trip(new DbTimeoutError(`D1 query timed out: ${this.summarize(query)}`));
    }, budget);

    const operation = call();

    // Racing does not cancel the query: D1 has no abort. The loser of the
    // race is still in flight, and if it later rejects with nobody attached
    // that surfaces as an unhandled rejection and, on Workers, can take down
    // the isolate. Attaching here keeps it observed. It logs rather than
    // swallowing: a query that failed after we stopped waiting is exactly the
    // evidence needed to tell a stalled primary from a broken statement.
    operation.catch((error: unknown) => {
      if (timedOut) {
        this.log.warn("D1 query failed after its budget had already expired", {
          query: this.summarize(query),
          error,
        });
      }
    });

    return Promise.race([operation, tripped]).finally(() => {
      this.dateTime.clearTimeout(timer);
    });
  }

  /**
   * Classifies a statement, conservatively: only a plain `SELECT` counts as
   * a read.
   *
   * `WITH` is deliberately excluded even though most CTEs are selects,
   * because `WITH ... INSERT` is legal and mistaking a write for a read is
   * the direction that hurts. Under `reads` the cost of being wrong that way
   * is a bounded write an app asked to leave alone; being wrong the other way
   * only leaves a read unbounded.
   */
  protected isRead(query: string): boolean {
    return /^\s*select\b/i.test(query);
  }

  /**
   * Keeps a runaway statement from filling the log line. The head of the SQL
   * is what identifies the query; the bound values are deliberately absent,
   * since they routinely hold personal data.
   */
  protected summarize(query: string): string {
    const flat = query.replace(/\s+/g, " ").trim();
    return flat.length > 200 ? `${flat.slice(0, 200)}...` : flat;
  }
}
