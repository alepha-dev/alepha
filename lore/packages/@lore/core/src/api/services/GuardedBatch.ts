import { $inject } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DatabaseProvider, sql, type SQLLike } from "alepha/orm";

import { batchGuards } from "../entities/batchGuards.ts";
import { LoreDatabase } from "./LoreDatabase.ts";

/**
 * A change and what must be written with it, together or not at all, on a
 * database with no transaction (D1).
 *
 * The batch opens with a guard row in `batch_guards` whose id is NULL when
 * the condition is false: its CHECK refuses it and the whole native
 * batch aborts, so a lost version or claim predicate is a rollback, not a
 * zero-row update followed by an unguarded insert. The batch closes by
 * deleting its guard row. The guard lives in a table of its own so nothing a
 * feature drops can take the guarantee with it (#Q3899).
 */
export class GuardedBatch {
  protected readonly crypto = $inject(CryptoProvider);
  protected readonly database = $inject(LoreDatabase);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly provider = $inject(DatabaseProvider);
  /**
   * Declared so the table enters the schema and its migrations; the batch
   * itself writes it with raw statements.
   */
  protected readonly guards = $repository(batchGuards);

  /**
   * Runs `statements` only if `condition` holds, all or nothing. Answers the
   * rows of the guard's insert first, then of each statement in order.
   *
   * On Postgres the batch is a READ COMMITTED transaction, so two batches
   * could both read the old row in their guard before either committed, and
   * both claim it. Each guarded batch there first takes one transaction-scoped
   * advisory lock: the next one waits for the commit, and its guard, a
   * statement of its own, reads the committed row. Guarded batches are short,
   * so serializing them is cheap. SQLite's exclusive transaction and D1's
   * batch already run one at a time.
   */
  public async guarded(condition: SQLLike, statements: SQLLike[]) {
    const id = this.crypto.randomUUID();
    const now = this.database.timestamp(this.dateTime.nowISOString());
    const predicate =
      typeof condition === "string" ? sql.raw(condition) : condition.getSQL();
    const lock = this.provider.dialect === "postgresql";
    const rows = await this.database.batch([
      ...(lock
        ? [sql`SELECT pg_advisory_xact_lock(${GuardedBatch.LOCK})`]
        : []),
      sql`INSERT INTO batch_guards (id, created_at)
          VALUES (CASE WHEN (${predicate}) THEN ${id} ELSE NULL END, ${now})`,
      ...statements,
      sql`DELETE FROM batch_guards WHERE id = ${id}`,
    ]);
    return lock ? rows.slice(1) : rows;
  }

  /**
   * The advisory lock key every guarded batch takes on Postgres.
   */
  public static readonly LOCK = 0x6c6f7265; // "lore"

  /**
   * Whether a guard holds right now. A failed `guarded` batch cannot say
   * whether its guard was false or the driver failed, and only the first is
   * a refusal a caller may skip; this asks the database the same question.
   */
  public async holds(condition: SQLLike): Promise<boolean> {
    const predicate =
      typeof condition === "string" ? sql.raw(condition) : condition.getSQL();
    const [rows] = await this.database.batch([
      sql`SELECT CASE WHEN (${predicate}) THEN 1 ELSE 0 END AS held`,
    ]);
    return Number(rows[0]?.held) === 1;
  }
}
