import { $inject, Alepha, AlephaError } from "alepha";
import { DatabaseProvider, sql, type SQLLike } from "alepha/orm";

import { AutomationD1Provider } from "../providers/AutomationD1Provider.ts";
import { AutomationSqliteProvider } from "../providers/AutomationSqliteProvider.ts";

/**
 * Bounded internal statements only. There is no public SQL or callback
 * workflow API, and no claim that a database batch can undo an external send.
 */
export class AutomationDatabase {
  protected readonly alepha = $inject(Alepha);
  protected readonly database = $inject(DatabaseProvider);

  public primary<T>(handler: () => T): T {
    return this.alepha.context.nest(() => {
      this.alepha.context.set("lore.automations.primary", true);
      return handler();
    });
  }

  /**
   * Whether a project has the Work `automations` option on, as a predicate a
   * native batch can carry. `options` is JSON text on SQLite and D1, jsonb on
   * Postgres; a project without the Work row has no option at all.
   */
  public automationsOn(projectId: number): SQLLike {
    return this.database.dialect === "sqlite"
      ? sql`EXISTS (SELECT 1 FROM project_capabilities WHERE project_id = ${projectId} AND key = 'work' AND json_extract(options, '$.automations') = 1)`
      : sql`EXISTS (SELECT 1 FROM project_capabilities WHERE project_id = ${projectId} AND key = 'work' AND (options ->> 'automations') = 'true')`;
  }

  public timestamp(value: string): string | number {
    const millis = new Date(value).getTime();
    if (!Number.isFinite(millis))
      throw new AlephaError("Invalid automation timestamp");
    return this.database.dialect === "sqlite" ? millis : value;
  }

  public numberFields(
    payload: object,
    fields: Record<string, SQLLike>,
  ): SQLLike {
    let value = sql`${JSON.stringify(payload)}`;
    for (const [name, expression] of Object.entries(fields)) {
      if (!/^[A-Za-z0-9_]+$/.test(name))
        throw new AlephaError("Invalid computed source field");
      const query =
        typeof expression === "string"
          ? sql.raw(expression)
          : expression.getSQL();
      value =
        this.database.dialect === "sqlite"
          ? sql`json_set(${value}, ${`$.fields.${name}`}, ${query})`
          : sql`jsonb_set((${value})::jsonb, ${`{fields,${name}}`}, COALESCE(to_jsonb(${query}), 'null'::jsonb))`;
    }
    return value;
  }

  /**
   * Internal domain IDs are read in the same batch as their generated row.
   * Only scalar receipt result slots can be filled, never arbitrary JSON.
   */
  public resultFields(
    result: object,
    fields: Record<string, SQLLike>,
  ): SQLLike {
    if (Object.keys(fields).length > 8)
      throw new AlephaError("Too many derived effect results");
    let value = sql`${JSON.stringify(result)}`;
    for (const [name, expression] of Object.entries(fields)) {
      if (
        !["quest_id", "shortId", "folio_id", "revision", "release_id"].includes(
          name,
        )
      )
        throw new AlephaError("Invalid derived effect result");
      const query =
        typeof expression === "string"
          ? sql.raw(expression)
          : expression.getSQL();
      value =
        this.database.dialect === "sqlite"
          ? sql`json_set(${value}, ${`$.${name}`}, ${query})`
          : sql`jsonb_set((${value})::jsonb, ${`{${name}}`}, COALESCE(to_jsonb(${query}), 'null'::jsonb))`;
    }
    return value;
  }

  public async batch(
    statements: SQLLike[],
  ): Promise<Array<Record<string, unknown>[]>> {
    if (!statements.length || statements.length > 100)
      throw new AlephaError(
        "An automation batch must contain 1 to 100 statements",
      );
    return this.primary(async () => {
      try {
        if (
          this.database instanceof AutomationD1Provider ||
          this.database instanceof AutomationSqliteProvider
        )
          return await this.database.atomicBatch(statements);
        if (!this.database.supportsTransactions)
          throw new AlephaError(
            "This database has no automation atomic-batch implementation",
          );
        return await this.database.transactional(async () => {
          const result: Array<Record<string, unknown>[]> = [];
          for (const statement of statements)
            result.push(await this.database.execute(statement));
          return result;
        });
      } catch {
        // Driver exceptions may contain bound values. The caller sees a safe
        // boundary failure; recovery inspects durable receipts on the primary.
        throw new AlephaError("Atomic automation batch failed");
      }
    });
  }
}
