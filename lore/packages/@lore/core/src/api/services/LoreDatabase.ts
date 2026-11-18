import { $inject, Alepha, AlephaError } from "alepha";
import {
  DatabaseProvider,
  SqlExpressionProvider,
  sql,
  type SQLLike,
} from "alepha/orm";

/**
 * Lore's bounded native batches and primary reads (#Q3899).
 *
 * - `batch` runs 1 to 100 statements through the framework's `atomicBatch`:
 *   together or not at all, on D1 too. There is no public SQL or callback
 *   workflow API, and no claim that a batch can undo an external send.
 * - `primary` runs a handler whose reads must see the latest write: on D1,
 *   `LorePrimaryD1Provider` sends them to the primary instead of a replica.
 */
export class LoreDatabase {
  protected readonly alepha = $inject(Alepha);
  protected readonly database = $inject(DatabaseProvider);
  protected readonly sqlx = $inject(SqlExpressionProvider);

  public primary<T>(handler: () => T): T {
    return this.alepha.context.nest(() => {
      this.alepha.context.set("lore.database.primary", true);
      return handler();
    });
  }

  public timestamp(value: string): string | number {
    const millis = new Date(value).getTime();
    if (!Number.isFinite(millis))
      throw new AlephaError("Invalid batch timestamp");
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

  public async batch(
    statements: SQLLike[],
  ): Promise<Array<Record<string, unknown>[]>> {
    if (!statements.length || statements.length > 100)
      throw new AlephaError("A native batch must contain 1 to 100 statements");
    return this.primary(async () => {
      try {
        // The 1 to 100 bound is Lore's own: one unit of work per batch.
        // `atomicBatch` itself takes any length.
        return await this.database.atomicBatch(statements);
      } catch {
        // Driver exceptions may contain bound values. The caller sees a safe
        // boundary failure; recovery reads durable rows on the primary.
        throw new AlephaError("Atomic batch failed");
      }
    });
  }
}
