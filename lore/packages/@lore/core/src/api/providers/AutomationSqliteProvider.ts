import { NodeSqliteProvider, type SQLLike } from "alepha/orm";

/**
 * A native atomic batch remains atomic even when a test disables ordinary
 * application transactions to emulate D1. It uses the driver's shared mutex.
 */
export class AutomationSqliteProvider extends NodeSqliteProvider {
  public async atomicBatch(
    statements: SQLLike[],
  ): Promise<Record<string, unknown>[][]> {
    const run = async () => {
      const rows: Record<string, unknown>[][] = [];
      for (const statement of statements)
        rows.push(await this.execute(statement));
      return rows;
    };
    if (this.alepha.get("alepha.orm.tx")) return run();
    return this.runExclusiveNativeTransaction(
      (statement) => this.requireSqlite().exec(statement),
      run,
    );
  }
}
