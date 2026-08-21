import { $env, $hook, $inject, AlephaError, z } from "alepha";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core";

import { DbTimeoutError } from "../../errors/DbTimeoutError.ts";
import type {
  D1Database,
  D1SessionBookmark,
} from "../../interfaces/D1Database.ts";
import { SqliteModelBuilder } from "../../services/SqliteModelBuilder.ts";
import { D1TimeoutProvider } from "./D1TimeoutProvider.ts";
import { DatabaseProvider, type SQLLike } from "./DatabaseProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The D1 binding types moved to `../../interfaces/D1Database.ts` so
 * `D1TimeoutProvider` can wrap a binding without importing this provider,
 * which would have closed a module cycle. They are re-exported here because
 * they were part of this module's public surface.
 */
export type {
  D1Database,
  D1DatabaseSession,
  D1ExecResult,
  D1PreparedStatement,
  D1Result,
  D1SessionBookmark,
  D1SessionConstraint,
} from "../../interfaces/D1Database.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Cloudflare D1 SQLite provider using Drizzle ORM.
 */
export class CloudflareD1Provider extends DatabaseProvider {
  protected readonly builder = $inject(SqliteModelBuilder);
  protected readonly timeouts = $inject(D1TimeoutProvider);
  protected readonly env = $env(
    z.object({
      DATABASE_URL: z.string().describe("Expect to be 'd1://binding'"),
      DATABASE_TIMEOUT: z
        .number()
        .optional()
        .describe(
          "Milliseconds a D1 query may take before it is abandoned. 0 disables. Defaults to 5000 on serverless, off elsewhere.",
        ),
      DATABASE_TIMEOUT_SCOPE: z
        .enum(["all", "reads"])
        .optional()
        .describe(
          "Whether the budget governs every statement ('all', default) or only reads ('reads').",
        ),
      DATABASE_D1_MODE: z
        .enum(["primary", "sessions"])
        .optional()
        .describe(
          "'primary' (default) sends every query to the D1 primary. 'sessions' uses the Sessions API so read replicas can serve reads.",
        ),
    }),
  );

  protected d1?: D1Database;
  protected drizzleDb?: DrizzleD1Database;

  /**
   * Kept from `onStart` so a session can be wrapped in drizzle without
   * re-running the dynamic import on every request.
   */
  protected drizzleFactory?: (client: any) => DrizzleD1Database;

  public get name() {
    return "sqlite";
  }

  public get driver() {
    return "d1";
  }

  public override readonly dialect = "sqlite";

  public override get url(): string {
    return this.env.DATABASE_URL;
  }

  /**
   * How long a query may take before it is abandoned, in milliseconds.
   *
   * Defaults to 5 seconds on serverless and to off everywhere else. The split
   * is deliberate: the hazard this guards against is a stalled D1 primary,
   * which only exists on Workers, while a local sqlite file has no such
   * failure mode and a long-running migration or seed would resent a ceiling.
   *
   * 0 disables it.
   */
  protected timeoutBudget(): number {
    const configured = this.env.DATABASE_TIMEOUT;
    if (configured !== undefined) {
      return Number(configured);
    }

    return this.alepha.isServerless() ? 5_000 : 0;
  }

  /**
   * Whether queries go through the Sessions API.
   *
   * Off unless asked for. Replication changes the consistency model an app
   * runs under, and a framework upgrade must not make that choice silently.
   * It also does nothing on a runtime with no `withSession`, so the binding
   * gets a vote too.
   */
  public sessionsEnabled(): boolean {
    return (
      // An existence check on the binding, not a call.
      // oxlint-disable-next-line typescript/unbound-method
      this.env.DATABASE_D1_MODE === "sessions" && Boolean(this.d1?.withSession)
    );
  }

  /**
   * Opens the session for the current async context.
   *
   * Pass the bookmark from the caller's previous response to get a replica at
   * least as current as their last write. Without one the session starts
   * `first-unconstrained`, taking whichever replica answers fastest, which is
   * the right trade for a caller who has not written anything yet.
   *
   * Called for you on the first query of a request. Call it directly only to
   * supply an incoming bookmark, which has to happen before that first query.
   */
  public openSession(bookmark?: D1SessionBookmark): void {
    if (!this.sessionsEnabled() || !this.d1?.withSession) {
      return;
    }

    // The context slot is how the HTTP layer supplies an incoming bookmark
    // without the ORM ever importing the server module: whoever owns the
    // request drops it in, and the session picks it up when it opens.
    //
    // Cast because the slot is declared in `orm/core/index.ts`, which this
    // file cannot import without closing a cycle, so the augmentation is not
    // visible from here.
    const carried = this.alepha.get("alepha.orm.d1.bookmark") as
      | D1SessionBookmark
      | undefined;

    const anchor = bookmark ?? carried ?? "first-unconstrained";

    const session = this.d1.withSession(anchor);
    const db = this.factory()(session) as unknown as PgAsyncDatabase<any>;

    this.alepha.store.set(
      "alepha.orm.d1.session",
      { session, db },
      { skipEvents: true },
    );

    // `store.set` writes to the INNERMOST async layer, and a request handler
    // runs several layers deep ($scope, transactional()). So the slot above is
    // invisible to whoever owns the request, which is exactly who needs the
    // bookmark to hand back.
    //
    // Mutating a holder that scope already owns crosses the boundary the store
    // cannot. `DatabaseProvider.transactional` drains `afterCommit` the same
    // way. Without it the bookmark never reached the response and cross-request
    // consistency was off while every unit test still passed.
    const carrier = this.alepha.get("alepha.orm.d1.carrier") as
      | { session?: unknown }
      | undefined;

    if (carrier) {
      carrier.session = session;
    }
  }

  /**
   * The bookmark to hand back to the caller, or null when there is nothing to
   * hand back.
   *
   * Returning it to the caller and accepting it on their next request is what
   * makes a read-after-write correct across two requests. Drop it and a user
   * who creates something can be shown a replica that has not caught up yet.
   */
  public sessionBookmark(): D1SessionBookmark | null {
    return (
      this.alepha.get("alepha.orm.d1.session")?.session.getBookmark() ?? null
    );
  }

  public override get db(): PgAsyncDatabase<any> {
    if (!this.drizzleDb) {
      throw new AlephaError("D1 database not initialized");
    }

    if (this.sessionsEnabled()) {
      const existing = this.alepha.get("alepha.orm.d1.session");
      if (existing) {
        return existing.db;
      }

      // Opened on first use rather than requiring every entry point to
      // remember: a request that slipped through unsessioned would quietly
      // read from the primary, losing the replication benefit with nothing
      // to show it happened.
      this.openSession();
      const opened = this.alepha.get("alepha.orm.d1.session");
      if (opened) {
        return opened.db;
      }
    }

    return this.drizzleDb as unknown as PgAsyncDatabase<any>;
  }

  protected factory(): (client: any) => DrizzleD1Database {
    if (!this.drizzleFactory) {
      throw new AlephaError("D1 database not initialized");
    }

    return this.drizzleFactory;
  }

  public override async execute(
    query: SQLLike,
  ): Promise<Array<Record<string, unknown>>> {
    // Use `.all()` — it returns the row array directly, exactly like
    // NodeSqliteProvider / BunSqliteProvider's `execute`. `.run()` returns
    // drizzle's D1 result envelope (`{ results, success, meta }`), which
    // has no `.rows` property: the previous `const { rows } = …run(query)`
    // destructured `undefined`, so EVERY raw-SQL SELECT on D1
    // (`Repository.query`, `DatabaseProvider.run`) silently returned `[]`.
    try {
      // `await`, not a bare return: without it the promise escapes the try
      // and the catch below never sees a rejection.
      return await (this.db as any).all(query);
    } catch (error) {
      // Raw `execute` bypasses `Repository.handleError`, so it has to do its
      // own unwrapping: drizzle demotes the driver error to `cause` and
      // throws its own `Failed query: ...` on top.
      throw DbTimeoutError.from(error) ?? error;
    }
  }

  /**
   * D1 does not support SQL-level transactions (BEGIN/COMMIT/ROLLBACK).
   * It rejects these statements and requires the JS `batch()` API for atomic
   * multi-statement operations instead.
   *
   * @see https://developers.cloudflare.com/d1/worker-api/d1-database/#batch-statements
   * @see https://github.com/drizzle-team/drizzle-orm/issues/2463
   */
  public override get supportsTransactions(): boolean {
    return false;
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      try {
        const [bindingName] = this.env.DATABASE_URL.replace("d1://", "").split(
          ":",
        );
        const cloudflareEnv = this.alepha.get("cloudflare.env") as
          | Record<string, unknown>
          | undefined;
        if (!cloudflareEnv) {
          throw new AlephaError(
            "Cloudflare Workers environment not found in Alepha store under 'cloudflare.env'.",
          );
        }

        const binding = cloudflareEnv[bindingName] as D1Database;
        if (!binding) {
          throw new AlephaError(
            `D1 binding '${bindingName}' not found in Cloudflare Workers environment.`,
          );
        }

        // Wrapped at the binding, not at the call sites: `drizzle-orm/d1`
        // only ever calls `prepare()` and `batch()`, so one wrapper covers
        // every query the app can issue without touching the twenty-odd
        // places `Repository` resolves a `db`.
        const budget = this.timeoutBudget();
        this.d1 =
          budget > 0
            ? this.timeouts.wrap(binding, budget, {
                applyTo: this.env.DATABASE_TIMEOUT_SCOPE ?? "all",
              })
            : binding;

        if (budget > 0) {
          this.log.debug("D1 queries are time-boxed", { budget });
        }

        // Dynamic import to avoid crashes when not on Cloudflare
        const { drizzle } = await import("drizzle-orm/d1");

        this.drizzleFactory = drizzle as (client: any) => DrizzleD1Database;
        this.drizzleDb = drizzle(this.d1) as DrizzleD1Database;

        if (this.env.DATABASE_D1_MODE === "sessions" && !this.d1.withSession) {
          this.log.warn(
            "D1 sessions requested but this runtime has no withSession; falling back to the primary",
          );
        }

        // Never migrate in serverless mode - D1 migrations must be applied
        // via `wrangler d1 migrations apply` before deployment
        if (!this.alepha.isServerless()) {
          await this.migrate();
        }

        this.log.info("Using Cloudflare D1 database");
      } catch (error) {
        // Log the full error for debugging since Cloudflare Workers
        // doesn't properly display error causes
        const errorMessage =
          error instanceof Error
            ? `${error.message}${error.stack ? `\n${error.stack}` : ""}`
            : String(error);
        this.log.error(`D1 initialization failed: ${errorMessage}`);
        throw error;
      }
    },
  });

  /**
   * D1 **is** affected by the migration foreign-key problem — an earlier
   * revision of this comment claimed otherwise and was wrong.
   *
   * The mistake was testing `wrangler d1 execute --file`, which runs
   * statements outside a transaction where drizzle-kit's leading
   * `PRAGMA foreign_keys=OFF` takes effect, while deploys actually use
   * `wrangler d1 migrations apply`, which runs each migration *inside* a
   * transaction where SQLite ignores that pragma. Same SQL, same
   * database, opposite outcomes:
   *
   *   wrangler d1 migrations apply  ->  0 of 5 child rows survive
   *   wrangler d1 execute --file    ->  5 of 5 survive
   *
   * It cost a production deploy 2434 rows across five tables.
   *
   * The fix is in the deploy path rather than here: `WranglerApi`
   * applies migrations with `execute --file` and keeps wrangler's
   * `d1_migrations` bookkeeping itself. This provider only runs when the
   * app boots against D1 directly (non-serverless), which is not the
   * deploy path, so it needs no pragma handling of its own — but do not
   * assume D1 is immune.
   */
  protected async executeMigrations(migrationsFolder: string): Promise<void> {
    this.log.debug(`Running D1 migrations from '${migrationsFolder}'...`);
    try {
      // Dynamic import for D1 migrator
      const { migrate } = await import("drizzle-orm/d1/migrator");
      await migrate(this.db as any, { migrationsFolder });
      this.log.debug("D1 migrations completed successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
      throw new AlephaError(
        `D1 migration failed from '${migrationsFolder}': ${errorMessage}`,
        { cause: error },
      );
    }
  }

  /**
   * D1 doesn't support push-based schema sync.
   * Always use file-based migrations regardless of environment.
   */
  public override async migrate(): Promise<void> {
    const migrationsFolder = this.getMigrationsFolder();
    try {
      await this.executeMigrations(migrationsFolder);
    } catch (error) {
      if (this.alepha.isTest()) {
        this.log.warn(
          "D1 migrations failed in test environment - ensure migrations exist",
        );
      } else {
        throw error;
      }
    }
  }
}
