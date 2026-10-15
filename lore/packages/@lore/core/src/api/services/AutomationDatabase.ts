import { $inject, Alepha, AlephaError } from "alepha";
import { DatabaseProvider, type SQLLike } from "alepha/orm";

import { AutomationD1Provider } from "../providers/AutomationD1Provider.ts";

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

  public timestamp(value: string): string | number {
    const millis = new Date(value).getTime();
    if (!Number.isFinite(millis))
      throw new AlephaError("Invalid automation timestamp");
    return this.database.dialect === "sqlite" ? millis : value;
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
        if (this.database instanceof AutomationD1Provider)
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
