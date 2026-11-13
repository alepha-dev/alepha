import { $inject, Alepha, AlephaError } from "alepha";
import {
  DatabaseProvider,
  SqlExpressionProvider,
  sql,
  type SQLLike,
} from "alepha/orm";

/**
 * Bounded internal statements only. There is no public SQL or callback
 * workflow API, and no claim that a database batch can undo an external send.
 */
export class AutomationDatabase {
  protected readonly alepha = $inject(Alepha);
  protected readonly database = $inject(DatabaseProvider);
  protected readonly sqlx = $inject(SqlExpressionProvider);

  public primary<T>(handler: () => T): T {
    return this.alepha.context.nest(() => {
      this.alepha.context.set("lore.automations.primary", true);
      return handler();
    });
  }

  /**
   * Whether a project has automations, as a predicate a native batch can
   * carry: whether it has Work, since automations are a baseline of Work
   * (#Q3594). A project without the Work row has none.
   */
  public automationsOn(projectId: number): SQLLike {
    return sql`EXISTS (SELECT 1 FROM project_capabilities WHERE project_id = ${projectId} AND key = 'work')`;
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
      value = this.sqlx.jsonSet(value, ["fields", name], query);
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
      value = this.sqlx.jsonSet(value, [name], query);
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
        // The 1 to 100 bound is the automation engine's own: one unit of
        // work per claim. `atomicBatch` itself takes any length.
        return await this.database.atomicBatch(statements);
      } catch {
        // Driver exceptions may contain bound values. The caller sees a safe
        // boundary failure; recovery inspects durable receipts on the primary.
        throw new AlephaError("Atomic automation batch failed");
      }
    });
  }
}
