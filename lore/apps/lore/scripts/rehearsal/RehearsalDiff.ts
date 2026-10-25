/**
 * One table's line in a rehearsal report.
 *
 * - `same`: the count did not move.
 * - `changed`: the count moved. A failure: no migration of #E74 inserts or
 *   deletes rows, and an `UPDATE` changes none.
 * - `grown`: the count rose, and an `alepha-rehearse-allow-insert` marker in
 *   the applied SQL names the table: a backfill (#Q2626). A drop in count
 *   there is still a failure.
 * - `dropped`: gone, and an `alepha-allow-drop-table` marker in the applied SQL
 *   names it.
 * - `vanished`: gone, and nothing names it. A failure.
 * - `new`: created by the migrations.
 */
export interface RehearsalRow {
  table: string;
  before?: number;
  after?: number;
  status: "same" | "changed" | "grown" | "dropped" | "vanished" | "new";
}

/**
 * What a rehearsal found: one row per table, and the reasons it failed.
 */
export interface RehearsalReport {
  rows: RehearsalRow[];
  failures: string[];
}

/**
 * Compares the row counts of a copy of production before and after its pending
 * migrations ran (#Q2603).
 *
 * Kept apart from the command that drives Cloudflare, so the rule that decides
 * pass or fail is tested without a database.
 */
export class RehearsalDiff {
  /**
   * The bookkeeping table the migration runner appends one row to per applied
   * migration: its growth is expected, and checked exactly.
   */
  public static readonly BOOKKEEPING = "d1_migrations";

  /**
   * The tables a migration's SQL drops under an `alepha-allow-drop-table`
   * marker: a `-- alepha-allow-drop-table: <why>` line directly above the
   * `DROP TABLE`, which is the framework's own rule (`check:migrations`).
   */
  public markedDrops(sql: string): string[] {
    const lines = sql.split("\n").map((line) => line.trim());
    const tables: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const drop = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"]?(\w+)[`"]?/i.exec(
        lines[i],
      );
      if (drop && /^--\s*alepha-allow-drop-table:/.test(lines[i - 1])) {
        tables.push(drop[1]);
      }
    }
    return tables;
  }

  /**
   * The tables a migration's SQL inserts into under an
   * `alepha-rehearse-allow-insert` marker: a `-- alepha-rehearse-allow-insert:
   * <why>` line directly above the `INSERT`. A backfill grows its table by
   * design (#Q2626), and the marker is what says so, in the migration that
   * does it.
   */
  public markedInserts(sql: string): string[] {
    const lines = sql.split("\n").map((line) => line.trim());
    const tables: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const insert = /^INSERT\s+(?:OR\s+\w+\s+)?INTO\s+[`"]?(\w+)[`"]?/i.exec(
        lines[i],
      );
      if (insert && /^--\s*alepha-rehearse-allow-insert:/.test(lines[i - 1])) {
        tables.push(insert[1]);
      }
    }
    return tables;
  }

  /**
   * Passes when every table that still exists kept its exact count (or grew,
   * when a marker allows inserts into it), every
   * table that disappeared is named by a marker in `appliedSql`, and the
   * bookkeeping table grew by exactly one row per applied migration.
   */
  public compare(
    before: Record<string, number>,
    after: Record<string, number>,
    appliedSql: string[],
  ): RehearsalReport {
    const marked = new Set(appliedSql.flatMap((sql) => this.markedDrops(sql)));
    const inserted = new Set(
      appliedSql.flatMap((sql) => this.markedInserts(sql)),
    );
    const tables = [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].sort();
    const rows: RehearsalRow[] = [];
    const failures: string[] = [];

    for (const table of tables) {
      const was = before[table];
      const now = after[table];

      if (table === RehearsalDiff.BOOKKEEPING) {
        const expected = (was ?? 0) + appliedSql.length;
        const ok = now === expected;
        rows.push({
          table,
          before: was,
          after: now,
          status: ok ? "same" : "changed",
        });
        if (!ok) {
          failures.push(
            `${table} holds ${now ?? "no"} rows, expected ${expected} (one per applied migration)`,
          );
        }
        continue;
      }

      if (was === undefined) {
        rows.push({ table, after: now, status: "new" });
      } else if (now === undefined) {
        const status = marked.has(table) ? "dropped" : "vanished";
        rows.push({ table, before: was, status });
        if (status === "vanished") {
          failures.push(
            `${table} disappeared and no alepha-allow-drop-table marker names it`,
          );
        }
      } else if (was === now) {
        rows.push({ table, before: was, after: now, status: "same" });
      } else if (now > was && inserted.has(table)) {
        rows.push({ table, before: was, after: now, status: "grown" });
      } else {
        rows.push({ table, before: was, after: now, status: "changed" });
        failures.push(`${table} went from ${was} rows to ${now}`);
      }
    }

    return { rows, failures };
  }
}
