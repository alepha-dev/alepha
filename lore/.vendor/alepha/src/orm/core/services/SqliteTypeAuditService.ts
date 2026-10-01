import { getTableColumns, sql } from "drizzle-orm";

import type { DatabaseProvider } from "../providers/drivers/DatabaseProvider.ts";

/**
 * One column whose stored values disagree with the type it was declared with.
 */
export interface SqliteTypeDrift {
  table: string;
  column: string;
  /**
   * The declared SQL type, lower-cased: `integer`, `real` or `text`.
   */
  declared: string;
  /**
   * Rows per offending storage class, e.g. `{ text: 15 }`.
   */
  found: Record<string, number>;
}

/**
 * The query an audit runs against one table, for a database this process
 * cannot reach (a remote D1, through `wrangler d1 execute --remote`).
 */
export interface SqliteTypeAuditStatement {
  table: string;
  columns: string[];
  sql: string;
}

/**
 * Finds rows whose storage class disagrees with their column's declared type.
 *
 * A SQLite table that is not `STRICT` converts a numeric-looking string on
 * the way into an INTEGER column and stores anything else verbatim, as TEXT,
 * without a word. The damage is not cosmetic: SQLite orders storage classes
 * before it orders values (NULL, then INTEGER and REAL, then TEXT, then
 * BLOB), so one text row in an integer column sorts ahead of the whole
 * table and `ORDER BY created_at DESC` stops meaning anything. Lore's admin
 * files list served a page holding both its oldest and its newest rows
 * this way, and the cause survived four readings of the ORM because the ORM
 * was correct (quest #1672).
 *
 * Nothing else compares the data to the schema: `db migrations check` reads
 * the schema alone. This does the other half, one `typeof()` count per
 * column, and is the pre-flight for making tables `STRICT` (quest #1674).
 *
 * SQLite and D1 only. Postgres rejects a wrong-typed value at the wire and
 * never had this hole, so {@link audit} answers nothing for it.
 */
export class SqliteTypeAuditService {
  /**
   * The storage classes a declared type may hold. `null` is always allowed:
   * nullability is the schema's business, not this check's. A REAL column
   * takes an integer because SQLite stores whole numbers as INTEGER under
   * REAL affinity when they round-trip exactly.
   */
  protected static readonly ALLOWED: Record<string, string[]> = {
    integer: ["integer"],
    real: ["real", "integer"],
    text: ["text"],
  };

  /**
   * One statement per table, from the entities registered on the provider.
   *
   * Derived from the code rather than from `PRAGMA table_info`, so it needs
   * no connection: the statements can be printed and run wherever the
   * database is. A column whose type takes anything (`blob`, `numeric`) is
   * left out, since nothing stored in it can disagree.
   */
  public plan(provider: DatabaseProvider): SqliteTypeAuditStatement[] {
    if (provider.dialect !== "sqlite") {
      return [];
    }

    const statements: SqliteTypeAuditStatement[] = [];
    for (const [table, model] of provider.tables) {
      const columns = Object.values(getTableColumns(model as any)).flatMap(
        (column: any) => {
          const declared = this.declaredType(column.getSQLType());
          return declared ? [{ name: column.name as string, declared }] : [];
        },
      );
      if (columns.length === 0) {
        continue;
      }

      const parts = columns.map(
        ({ name, declared }) =>
          `SELECT ${this.literal(name)} AS "column", ${this.literal(declared)} AS "declared", typeof(${this.quote(name)}) AS "storage" FROM ${this.quote(table)} WHERE typeof(${this.quote(name)}) NOT IN (${this.allowedList(declared)})`,
      );
      statements.push({
        table,
        columns: columns.map((it) => it.name),
        sql: `SELECT "column", "declared", "storage", COUNT(*) AS "rows" FROM (${parts.join(" UNION ALL ")}) GROUP BY "column", "declared", "storage"`,
      });
    }
    return statements;
  }

  /**
   * Run the plan against the provider's own database and collect the drift.
   */
  public async audit(provider: DatabaseProvider): Promise<SqliteTypeDrift[]> {
    const drift: SqliteTypeDrift[] = [];
    for (const statement of this.plan(provider)) {
      const rows = await provider.execute(sql.raw(statement.sql));
      const byColumn = new Map<string, SqliteTypeDrift>();
      for (const row of rows) {
        const column = String(row.column);
        const entry = byColumn.get(column) ?? {
          table: statement.table,
          column,
          declared: String(row.declared),
          found: {},
        };
        entry.found[String(row.storage)] = Number(row.rows);
        byColumn.set(column, entry);
      }
      drift.push(...byColumn.values());
    }
    return drift;
  }

  /**
   * `integer(…)`, `INTEGER`, `text(255)` all read as their family; anything
   * outside the three checked families reads as nothing.
   */
  protected declaredType(sqlType: string): string | undefined {
    const family = sqlType.toLowerCase().split("(")[0].trim();
    return family in SqliteTypeAuditService.ALLOWED ? family : undefined;
  }

  protected allowedList(declared: string): string {
    return [...SqliteTypeAuditService.ALLOWED[declared], "null"]
      .map((it) => this.literal(it))
      .join(", ");
  }

  /**
   * Backticks, never double quotes. SQLite resolves a double-quoted name
   * that matches no column as a STRING LITERAL, so `typeof("gone")` on a
   * database whose schema lags the code answers `text` for every row and
   * the audit reports drift that is not there (it did, against a production
   * database two migrations behind). A backticked name is an identifier
   * only, and a missing column is an error naming it.
   */
  protected quote(identifier: string): string {
    return `\`${identifier.replace(/`/g, "``")}\``;
  }

  protected literal(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }
}
