import type { ArtifactDialectSchema } from "../schemas/artifactSchemaSchema.ts";

/**
 * One way the live schema differs from what an older build expects.
 *
 * - `breaks`: the older build's own queries fail. A table or column it reads
 *   is gone (a rename is a drop plus an add), or a column it never fills is
 *   now `NOT NULL` with nothing to fill it.
 * - `risky`: some of its writes can be refused. A column changed type or
 *   became `NOT NULL`, or a unique index, foreign key or check arrived.
 */
export interface SchemaChange {
  severity: "breaks" | "risky";
  /**
   * `users.email dropped`: an identifier, then what happened to it. Shown as
   * is in every surface, so it stays short and technical.
   */
  change: string;
}

/**
 * Whether an older build still runs on a newer schema, read from Drizzle's
 * snapshots rather than from SQL (#Q3542).
 *
 * A Drizzle `snapshot.json` describes the WHOLE schema after its migration,
 * so two of them compare by end state: a SQLite table rebuild, a squash or a
 * hand-reordered migration cannot confuse it, because none of the SQL is
 * read. What it cannot see is a data migration, an `UPDATE` that changes no
 * structure, which leaves the snapshot as it was.
 */
export class SchemaCompatibility {
  /**
   * The snapshot format this reads: drizzle-kit 1's `ddl` list, version 7
   * for SQLite and 8 for Postgres. Anything else reduces to `undefined`, and
   * the rollback falls back to counting migrations.
   */
  protected static readonly KINDS = new Set([
    "tables",
    "columns",
    "indexes",
    "fks",
    "checks",
  ]);

  /**
   * One Drizzle snapshot, reduced to what {@link compare} reads, or
   * `undefined` when it is not a snapshot this understands.
   */
  public reduce(snapshot: unknown): ArtifactDialectSchema | undefined {
    const ddl = (snapshot as { ddl?: unknown } | null)?.ddl;
    if (!Array.isArray(ddl)) {
      return undefined;
    }
    const tables: ArtifactDialectSchema["tables"] = {};
    const constraints: string[] = [];
    for (const raw of ddl) {
      const entry = raw as Record<string, any>;
      if (!SchemaCompatibility.KINDS.has(entry?.entityType)) {
        continue;
      }
      if (entry.entityType === "tables") {
        tables[this.tableOf(entry, "name")] ??= {};
        continue;
      }
      const table = this.tableOf(entry, "table");
      if (entry.entityType === "columns") {
        tables[table] ??= {};
        tables[table][String(entry.name)] = {
          type: String(entry.type ?? ""),
          notNull: entry.notNull === true,
          filled:
            (entry.default !== null && entry.default !== undefined) ||
            entry.autoincrement === true ||
            (entry.generated !== null && entry.generated !== undefined) ||
            (entry.identity !== null && entry.identity !== undefined),
        };
        continue;
      }
      if (entry.entityType === "indexes") {
        if (entry.isUnique !== true) {
          continue;
        }
        const columns = (entry.columns ?? []).map((it: any) =>
          typeof it === "string" ? it : String(it?.value),
        );
        const where = entry.where ? ` where ${entry.where}` : "";
        constraints.push(
          `unique index ${table} (${columns.join(", ")})${where}`,
        );
        continue;
      }
      if (entry.entityType === "fks") {
        const to = this.tableOf(entry, "tableTo", "schemaTo");
        constraints.push(
          `foreign key ${table} (${(entry.columns ?? []).join(", ")}) -> ${to} (${(entry.columnsTo ?? []).join(", ")})`,
        );
        continue;
      }
      constraints.push(`check ${table} ${String(entry.value)}`);
    }
    return { tables, constraints: [...new Set(constraints)].sort() };
  }

  /**
   * What stands between a build expecting `older` and a database at `live`.
   *
   * Empty means the live schema only ADDS to what the older build expects:
   * new tables, nullable or filled columns, plain indexes, dropped
   * constraints. Its code never names the additions, so it runs.
   */
  public compare(
    older: ArtifactDialectSchema,
    live: ArtifactDialectSchema,
  ): SchemaChange[] {
    const changes: SchemaChange[] = [];
    for (const [table, columns] of Object.entries(older.tables)) {
      const now = live.tables[table];
      if (!now) {
        changes.push({ severity: "breaks", change: `${table} dropped` });
        continue;
      }
      for (const [name, column] of Object.entries(columns)) {
        const current = now[name];
        if (!current) {
          changes.push({
            severity: "breaks",
            change: `${table}.${name} dropped`,
          });
          continue;
        }
        if (current.type.toLowerCase() !== column.type.toLowerCase()) {
          changes.push({
            severity: "risky",
            change: `${table}.${name} ${column.type} -> ${current.type}`,
          });
        }
        if (current.notNull && !column.notNull) {
          changes.push({
            severity: "risky",
            change: `${table}.${name} now NOT NULL`,
          });
        }
      }
      for (const [name, column] of Object.entries(now)) {
        if (!columns[name] && column.notNull && !column.filled) {
          changes.push({
            severity: "breaks",
            change: `${table}.${name} added NOT NULL with no default`,
          });
        }
      }
    }
    const before = new Set(older.constraints);
    for (const constraint of live.constraints) {
      // A constraint on a table the older build never had cannot refuse one
      // of its writes. `unique index` and `foreign key` are two words, so
      // their table is the third word; `check` carries it second.
      const words = constraint.split(" ");
      const on = words[0] === "check" ? words[1] : words[2];
      if (!before.has(constraint) && on && older.tables[on]) {
        changes.push({ severity: "risky", change: `${constraint} added` });
      }
    }
    return changes;
  }

  /**
   * `schema.table` for a Postgres entry outside `public`, the bare table
   * otherwise, so a SQLite and a Postgres snapshot of the same app name
   * their tables the way their queries do.
   */
  protected tableOf(
    entry: Record<string, any>,
    field: string,
    schemaField = "schema",
  ): string {
    const schema = entry[schemaField];
    const name = String(entry[field]);
    return schema && schema !== "public" ? `${schema}.${name}` : name;
  }
}
