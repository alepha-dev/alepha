import { AlephaError } from "alepha";
import { CloudflareD1Provider, sql, type SQLLike } from "alepha/orm";

/**
 * The narrow D1 seam used by stored programs: primary reads for revocable
 * authority, and the binding's atomic prepared batch for intent/effect writes.
 * Normal application reads keep the framework's configured session behavior.
 */
export class AutomationD1Provider extends CloudflareD1Provider {
  public override get db(): CloudflareD1Provider["db"] {
    if (this.alepha.get("lore.automations.primary")) {
      if (!this.drizzleDb)
        throw new AlephaError("D1 database is not initialized");
      return this.drizzleDb as unknown as CloudflareD1Provider["db"];
    }
    return super.db;
  }

  public async atomicBatch(
    statements: SQLLike[],
  ): Promise<Array<Record<string, unknown>[]>> {
    if (!this.drizzleDb)
      throw new AlephaError("D1 database is not initialized");
    // all() prepares a lazy query. batch() executes those prepared statements
    // together through the existing timeout-wrapped primary binding.
    const queries = statements.map((statement) =>
      this.drizzleDb!.all(
        typeof statement === "string" ? sql.raw(statement) : statement.getSQL(),
      ),
    );
    return this.drizzleDb.batch(queries as any) as Promise<
      Array<Record<string, unknown>[]>
    >;
  }
}

declare module "alepha" {
  interface State {
    "lore.automations.primary"?: boolean;
  }
}
